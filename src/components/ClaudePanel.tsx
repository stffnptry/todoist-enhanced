import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { addDays, startOfDay } from 'date-fns';
import { Icon } from './Icon';
import { useT } from '@/hooks/useT';
import { useData } from '@/hooks/useData';
import { useStore } from '@/store/store';
import { rootItems } from '@/store/selectors';
import { effectiveEstimate } from '@/domain/estimates';
import { formatTime, toApiDateTime } from '@/domain/dates';
import { dueForDate } from '@/domain/recurrence';
import { plainTitle } from '@/domain/reminders';
import { renderMarkdown } from '@/domain/markdown';
import { decisionLogLines, localDateTime, parsePlanAnswer, plannerSystemPrompt, type PlanAction } from '@/domain/planner';
import { DEFAULT_TASK_MINUTES, type CalendarEvent, type CalendarInfo } from '@/domain/calendar';
import { calendarCall, createTaskEvent } from '@/lib/desktopCalendar';
import { calendarSyncOn, requestCalendarSync } from '@/hooks/useCalendarSync';
import { intlLocale, type Locale } from '@/i18n';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  actions: PlanAction[];
  /** Indexes of the proposals ticked for applying; null once applied. */
  chosen: number[] | null;
  /** Facts Claude proposes to remember, and the ticked ones; null once kept. */
  memory: string[];
  memoryChosen: number[] | null;
  error?: boolean;
}

const LANGUAGE: Record<Locale, string> = { de: 'German', fr: 'French', en: 'English' };
const newId = () => Math.random().toString(36).slice(2);

/** While Claude is still writing, the proposal and memory blocks are not shown as text. */
const visibleWhileStreaming = (text: string) => text.split(/```(?:actions|memory)/)[0];

/**
 * Planning with Claude, in a panel at the right of the window (desktop app).
 *
 * Every message goes to the Claude CLI on this Mac with the account as it
 * stands: open tasks, estimates, capacity and the next week's events. Claude
 * answers in words and may propose changes; those are listed with a tick
 * each, and only the ones applied here change anything.
 */
export function ClaudePanel({ open, onClose, onOpenTask }: { open: boolean; onClose: () => void; onOpenTask: (id: string) => void }) {
  const { t, locale } = useT();
  const { snapshot, items, childrenOf } = useData();
  const prefs = useStore((s) => s.prefs);
  const updateTask = useStore((s) => s.updateTask);
  const toast = useStore((s) => s.toast);

  const [available, setAvailable] = useState<boolean | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState('');
  const [running, setRunning] = useState<string | null>(null);
  const [streaming, setStreaming] = useState('');
  const sessionId = useRef<string | null>(null);
  const list = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);

  const roots = useMemo(() => rootItems(items), [items]);
  const minutesOf = (item: (typeof items)[number]) => effectiveEstimate(item, childrenOf).minutes ?? null;

  useEffect(() => {
    if (!open || available !== null) return;
    const claude = window.enhancedDesktop?.claude;
    if (claude) void claude.available().then(setAvailable);
    else setAvailable(false);
  }, [open, available]);

  useEffect(() => { if (open) input.current?.focus(); }, [open]);
  useEffect(() => { list.current?.scrollTo({ top: list.current.scrollHeight }); }, [messages, streaming]);

  // Claude's answer arrives in pieces; the last piece carries the session to continue.
  useEffect(() => {
    const claude = window.enhancedDesktop?.claude;
    if (!claude) return undefined;
    return claude.onEvent((event) => {
      if (event.requestId !== running) return;
      if (event.type === 'delta') {
        setStreaming((text) => text + (event.text ?? ''));
        return;
      }
      if (event.sessionId) sessionId.current = event.sessionId;
      const isOpen = (id: string) => !!snapshot.items[id] && !snapshot.items[id].checked && !snapshot.items[id].is_deleted;
      setMessages((all) => {
        if (event.type === 'done') {
          const { text, actions, memory } = parsePlanAnswer(event.text ?? '', isOpen);
          return [...all, {
            id: newId(), role: 'assistant', text, actions, chosen: actions.map((_, i) => i),
            memory, memoryChosen: memory.map((_, i) => i),
          }];
        }
        const reason = event.type === 'cancelled'
          ? t('claude.cancelled')
          : event.error === 'not-installed' ? t('claude.notInstalled') : t('claude.error', { reason: String(event.error ?? '') });
        return [...all, { id: newId(), role: 'assistant', text: reason, actions: [], chosen: null, memory: [], memoryChosen: null, error: true }];
      });
      setStreaming('');
      setRunning(null);
    });
  }, [running, snapshot.items, t]);

  /** What Claude is told: read fresh for every message, events included. */
  const systemPrompt = async () => {
    let events: CalendarEvent[] = [];
    let calendars: CalendarInfo[] = [];
    const status = await calendarCall('status');
    if (status.granted) {
      const listed = await calendarCall('calendars');
      calendars = (listed.calendars as CalendarInfo[]) ?? [];
      const ids = prefs.calendarIds ?? calendars.map((c) => c.id);
      const today = startOfDay(new Date());
      const read = await calendarCall('events', { from: today.toISOString(), to: addDays(today, 8).toISOString(), calendars: ids });
      events = (read.events as CalendarEvent[]) ?? [];
    }
    return plannerSystemPrompt({
      snapshot, roots, minutesOf, events, calendars,
      capacity: prefs.dailyCapacity,
      now: new Date(),
      language: LANGUAGE[locale] ?? 'German',
      calendarTarget: prefs.calendarTarget,
    });
  };

  const send = async (text: string) => {
    const message = text.trim();
    const claude = window.enhancedDesktop?.claude;
    if (!message || running || !claude) return;
    const requestId = newId();
    setMessages((all) => [...all, { id: newId(), role: 'user', text: message, actions: [], chosen: null, memory: [], memoryChosen: null }]);
    setDraft('');
    setStreaming('');
    setRunning(requestId);
    claude.ask({ requestId, message, system: await systemPrompt(), sessionId: sessionId.current });
  };

  const reset = () => {
    if (running) window.enhancedDesktop?.claude?.cancel(running);
    sessionId.current = null;
    setMessages([]);
    setStreaming('');
    setRunning(null);
  };

  const onKey = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      void send(draft);
    }
  };

  /* ---------- Proposals ---------- */

  const describe = (action: PlanAction) => {
    const item = snapshot.items[action.taskId];
    const name = item ? plainTitle(item.content) : action.taskId;
    if (action.type === 'date') {
      const day = new Date(`${action.date}T00:00:00`);
      return { name, when: new Intl.DateTimeFormat(intlLocale(locale), { weekday: 'short', day: 'numeric', month: 'short' }).format(day) };
    }
    const start = localDateTime(action.start);
    const end = new Date(start.getTime() + action.minutes * 60_000);
    const day = new Intl.DateTimeFormat(intlLocale(locale), { weekday: 'short', day: 'numeric', month: 'short' }).format(start);
    return { name, when: `${day} ${formatTime(start, locale, prefs.hour12)}–${formatTime(end, locale, prefs.hour12)}` };
  };

  const apply = async (message: Message) => {
    if (!message.chosen) return;
    const chosen = message.chosen.map((i) => message.actions[i]);
    const target = prefs.calendarTarget;
    let calendarFailed = false;
    for (const action of chosen) {
      const item = snapshot.items[action.taskId];
      if (!item) continue;
      if (action.type === 'date') {
        void updateTask(item.id, { due: dueForDate(item.due, action.date, 'en', { dropTime: true }) });
        continue;
      }
      const start = localDateTime(action.start);
      // With the calendar kept in step, the next pass writes the block.
      if (target && !calendarSyncOn(prefs)) {
        const answer = await createTaskEvent(item, target, start, action.minutes || DEFAULT_TASK_MINUTES);
        if (!answer.ok) calendarFailed = true;
      }
      void updateTask(item.id, { due: dueForDate(item.due, toApiDateTime(start)) });
    }
    if (calendarSyncOn(prefs)) requestCalendarSync();
    // What was taken and what was unticked, so Claude can learn the pattern.
    window.enhancedDesktop?.claude?.log?.(decisionLogLines(new Date(), message.actions.map((action, i) => ({
      ...describe(action), accepted: message.chosen!.includes(i),
    }))));
    setMessages((all) => all.map((m) => (m.id === message.id ? { ...m, chosen: null } : m)));
    toast(t('claude.appliedToast', { count: chosen.length }));
    if (calendarFailed) toast(t('claude.calendarFailed'), undefined, { tone: 'error' });
  };

  const toggleChoice = (message: Message, index: number) =>
    setMessages((all) => all.map((m) => {
      if (m.id !== message.id || !m.chosen) return m;
      const chosen = m.chosen.includes(index) ? m.chosen.filter((i) => i !== index) : [...m.chosen, index].sort();
      return { ...m, chosen };
    }));

  /* ---------- Memory ---------- */

  const remember = (message: Message) => {
    if (!message.memoryChosen) return;
    const lines = message.memoryChosen.map((i) => message.memory[i]);
    window.enhancedDesktop?.claude?.remember?.(lines);
    setMessages((all) => all.map((m) => (m.id === message.id ? { ...m, memoryChosen: null } : m)));
    toast(t('claude.rememberedToast', { count: lines.length }));
  };

  const toggleMemory = (message: Message, index: number) =>
    setMessages((all) => all.map((m) => {
      if (m.id !== message.id || !m.memoryChosen) return m;
      const memoryChosen = m.memoryChosen.includes(index) ? m.memoryChosen.filter((i) => i !== index) : [...m.memoryChosen, index].sort();
      return { ...m, memoryChosen };
    }));

  if (!open) return null;

  const quick: Array<[string, string]> = [
    [t('claude.quick.day'), t('claude.prompt.day')],
    [t('claude.quick.week'), t('claude.prompt.week')],
    [t('claude.quick.focus'), t('claude.prompt.focus')],
  ];

  return (
    <aside className="claudepanel" aria-label="Claude">
      {/* The same head as an opened task's panel: a crumb on the left, icons on the right. */}
      <div className="detail-top claude-head">
        <span className="crumb"><Icon name="sparkles" size="sm" /> Claude</span>
        <span className="claude-head-actions">
        <button className="iconbtn" title={t('claude.new')} aria-label={t('claude.new')} onClick={reset} disabled={messages.length === 0 && !running}>
          <Icon name="plus" size="sm" />
        </button>
        <button className="iconbtn" title={t('claude.close')} aria-label={t('claude.close')} onClick={onClose}>
          <Icon name="close" size="sm" />
        </button>
        </span>
      </div>

      <div className="claude-list" ref={list}>
        {available === false && <p className="claude-note error">{t('claude.notInstalled')}</p>}
        {messages.length === 0 && available !== false && (
          <div className="claude-empty">
            <p>{t('claude.intro')}</p>
            <div className="claude-quick">
              {quick.map(([label, prompt]) => (
                <button key={label} className="btn" onClick={() => void send(prompt)} disabled={!!running}>{label}</button>
              ))}
            </div>
            <p className="claude-note">{t('claude.privacy')}</p>
          </div>
        )}
        {messages.map((m) => (
          <div key={m.id} className={`claude-msg ${m.role}${m.error ? ' error' : ''}`}>
            {m.role === 'user'
              ? <p>{m.text}</p>
              : <div className="md" dangerouslySetInnerHTML={{ __html: renderMarkdown(m.text) }} />}
            {m.actions.length > 0 && (
              <div className="claude-actions">
                <h3>{t('claude.proposals')}</h3>
                <ul>
                  {m.actions.map((action, i) => {
                    const { name, when } = describe(action);
                    return (
                      <li key={i}>
                        <label>
                          <input
                            type="checkbox"
                            checked={m.chosen ? m.chosen.includes(i) : true}
                            disabled={!m.chosen}
                            onChange={() => toggleChoice(m, i)}
                          />
                          <span className="claude-when">{when}</span>
                          <button className="claude-task" onClick={() => onOpenTask(action.taskId)}>{name}</button>
                        </label>
                      </li>
                    );
                  })}
                </ul>
                {m.chosen
                  ? (
                    <button className="btn primary" disabled={m.chosen.length === 0} onClick={() => void apply(m)}>
                      {t('claude.apply', { count: m.chosen.length })}
                    </button>
                  )
                  : <p className="claude-applied"><Icon name="check" size="sm" /> {t('claude.applied')}</p>}
              </div>
            )}
            {m.memory.length > 0 && (
              <div className="claude-actions claude-memory">
                <h3>{t('claude.memory')}</h3>
                <ul>
                  {m.memory.map((line, i) => (
                    <li key={i}>
                      <label>
                        <input
                          type="checkbox"
                          checked={m.memoryChosen ? m.memoryChosen.includes(i) : true}
                          disabled={!m.memoryChosen}
                          onChange={() => toggleMemory(m, i)}
                        />
                        <span>{line}</span>
                      </label>
                    </li>
                  ))}
                </ul>
                {m.memoryChosen
                  ? (
                    <button className="btn" disabled={m.memoryChosen.length === 0} onClick={() => remember(m)}>
                      {t('claude.remember', { count: m.memoryChosen.length })}
                    </button>
                  )
                  : <p className="claude-applied"><Icon name="check" size="sm" /> {t('claude.remembered')}</p>}
              </div>
            )}
          </div>
        ))}
        {running && (
          <div className="claude-msg assistant">
            {streaming
              ? <div className="md" dangerouslySetInnerHTML={{ __html: renderMarkdown(visibleWhileStreaming(streaming)) }} />
              : <p className="claude-thinking">{t('claude.thinking')}</p>}
          </div>
        )}
      </div>

      <div className="claude-input">
        <textarea
          ref={input}
          rows={2}
          value={draft}
          placeholder={t('claude.placeholder')}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKey}
          disabled={available === false}
        />
        {running
          ? <button className="btn" onClick={() => window.enhancedDesktop?.claude?.cancel(running)}>{t('claude.stop')}</button>
          : <button className="btn primary" disabled={!draft.trim() || available === false} onClick={() => void send(draft)}>{t('claude.send')}</button>}
      </div>
    </aside>
  );
}
