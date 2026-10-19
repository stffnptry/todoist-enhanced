import { useEffect, useMemo, useRef, useState } from 'react';
import { Overlay } from './Overlay';
import { useConfirm } from './Confirm';
import { Icon } from '../Icon';
import { useT } from '@/hooks/useT';
import { useStore } from '@/store/store';
import { dueDate, formatDay, formatDayOrName, formatTime } from '@/domain/dates';
import { renderTitle } from '@/domain/markdown';
import { displayTaskContent, type Item } from '@/domain/types';
import { dropMutation, type DropTarget } from '@/domain/dnd';
import {
  defaultReplanDate, dueTimeOf, isOverdue, nextToReplan, overdueDescendants, replanShortcuts, rescheduleCommentText,
} from '@/domain/replan';

interface ReplanDialogProps {
  open: boolean;
  onClose: () => void;
  /**
   * Die offenen Aufgaben der Ansicht, in ihrer Reihenfolge – live, damit eine
   * erledigte, gelöschte oder verschobene Aufgabe von selbst herausfällt.
   */
  items: readonly Item[];
}

/**
 * „Neu planen“ (Heute, Fokus): immer eine Aufgabe, drei Wege – erledigen,
 * löschen, umplanen. Umplanen geht nur mit Begründung; die landet als
 * Verschiebe-Kommentar an der Aufgabe. Danach kommt die nächste. Schließen
 * geht jederzeit (Escape, ✕, Klick daneben).
 */
export function ReplanDialog({ open, onClose, items }: ReplanDialogProps) {
  const { t } = useT();
  return (
    <Overlay open={open} onClose={onClose} label={t('replan.title')} size="sm">
      {open && <ReplanBody items={items} onClose={onClose} />}
    </Overlay>
  );
}

function ReplanBody({ items, onClose }: { items: readonly Item[]; onClose: () => void }) {
  const { t, locale } = useT();
  const confirm = useConfirm();
  const snapshot = useStore((s) => s.snapshot);
  const dateFormat = useStore((s) => s.prefs.dateFormat);
  const hour12 = useStore((s) => s.prefs.hour12);
  const toggleTask = useStore((s) => s.toggleTask);
  const removeTask = useStore((s) => s.removeTask);
  const sendTo = useStore((s) => s.sendTo);
  const updateMany = useStore((s) => s.updateMany);
  const addComment = useStore((s) => s.addComment);
  const toast = useStore((s) => s.toast);

  /* Was in dieser Runde schon behandelt wurde. Die Gesamtzahl bleibt so
     stehen, auch wenn die Ansicht unter dem Dialog schrumpft. */
  const [handled, setHandled] = useState<Set<string>>(() => new Set());
  const [busy, setBusy] = useState(false);
  const [skipped, setSkipped] = useState(0);
  const [moving, setMoving] = useState(false);
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [reason, setReason] = useState('');
  const reasonRef = useRef<HTMLTextAreaElement>(null);

  const current = nextToReplan(items, handled);
  const remaining = items.filter((item) => !item.checked && !handled.has(item.id)).length;
  const total = handled.size + remaining;
  const shortcuts = useMemo(() => replanShortcuts(), []);

  /* Jede neue Aufgabe beginnt wieder bei den drei Knöpfen. */
  useEffect(() => {
    setMoving(false);
    setDate(current ? defaultReplanDate(current) : shortcuts.tomorrow);
    setTime(current ? dueTimeOf(current) : '');
    setReason('');
  }, [current?.id, shortcuts.tomorrow]); // eslint-disable-line react-hooks/exhaustive-deps -- nur beim Wechsel der Aufgabe

  /* Umplanen öffnet das Feld für den Grund: dorthin gehört die Tastatur. */
  useEffect(() => {
    if (moving) requestAnimationFrame(() => reasonRef.current?.focus());
  }, [moving]);

  const done = (id: string) => setHandled((prev) => new Set(prev).add(id));

  /** Ein Tag (und ggf. eine Uhrzeit) in Worten, für Dialog und Kommentar. */
  const describe = (day: Date, at: string, relative: boolean): string => {
    const name = relative ? formatDayOrName(day, locale, dateFormat) : formatDay(day, locale, dateFormat);
    if (!at) return name;
    const [h, m] = at.split(':').map(Number);
    const clock = new Date(day);
    clock.setHours(h ?? 0, m ?? 0, 0, 0);
    return `${name}, ${formatTime(clock, locale, hour12)}`;
  };

  if (!current) {
    return (
      <>
        <Head onClose={onClose} />
        <div className="sheet-body replan-done">
          <p className="replan-done-mark" aria-hidden="true">✓</p>
          <p>{total > 0 ? t('replan.allDone', { count: total }) : t('replan.nothing')}</p>
          {skipped > 0 && <p className="replan-hint">{t('replan.skippedCount', { count: skipped })}</p>}
        </div>
        <div className="sheet-foot">
          <button className="btn primary" data-autofocus onClick={onClose}>{t('common.close')}</button>
        </div>
      </>
    );
  }

  const was = dueDate(current);
  const project = snapshot.projects[current.project_id]?.name;
  const position = handled.size + 1;
  const isLate = isOverdue(current);
  const parent = current.parent_id ? snapshot.items[current.parent_id] : undefined;
  /* Überfällige Unteraufgaben erben den neuen Termin. */
  const lateChildren = overdueDescendants(current.id, snapshot.items);

  async function complete() {
    if (!current || busy) return;
    setBusy(true);
    try {
      await toggleTask(current.id);
      done(current.id);
    } finally { setBusy(false); }
  }

  /* Überspringen ändert nichts an der Aufgabe: sie bleibt, wo sie ist, und
     kommt in dieser Runde nicht noch einmal. */
  function skip() {
    if (!current || busy) return;
    setSkipped((n) => n + 1);
    done(current.id);
  }

  async function remove() {
    if (!current || busy) return;
    const ok = await confirm({
      title: t('replan.deleteTitle'),
      body: t('task.deleteConfirm', { name: displayTaskContent(current) }),
      confirmLabel: t('task.delete'),
      destructive: true,
    });
    if (!ok) return;
    setBusy(true);
    try {
      await removeTask(current.id);
      done(current.id);
    } finally { setBusy(false); }
  }

  const target = date ? new Date(`${date}T00:00:00`) : null;
  const text = target
    ? rescheduleCommentText(
      t('replan.commentHeadline', {
        from: was ? describe(was, dueTimeOf(current), false) : t('replan.noDate'),
        to: describe(target, time, false),
      }),
      reason,
    )
    : null;

  async function reschedule() {
    if (!current || !target || !text || busy) {
      if (!reason.trim()) reasonRef.current?.focus();
      return;
    }
    setBusy(true);
    try {
      /* Erst der Kommentar: Lehnt Todoist ihn ab, bleibt die Aufgabe, wo sie
         war, und der Grund steht noch im Feld. */
      const ok = await addComment(current.id, text);
      if (!ok) {
        toast(t('replan.commentFailed'), undefined, { tone: 'error' });
        return;
      }
      const where: DropTarget = { kind: 'day', date: target, time: time ? `${time}:00` : undefined };
      await sendTo(current.id, where, describe(target, time, true));
      if (lateChildren.length > 0) {
        /* Wie die Aufgabe selbst: Regel und Uhrzeit bleiben, das Wochen-Label geht. */
        await updateMany(
          lateChildren.map((child) => child.id),
          (child) => dropMutation(child, where)?.update ?? null,
          t('replan.childrenMoved', { count: lateChildren.length }),
        );
        /* Schon mitverschoben: in dieser Runde nicht noch einmal fragen. */
        setHandled((prev) => new Set([...prev, ...lateChildren.map((child) => child.id)]));
      }
      done(current.id);
    } finally { setBusy(false); }
  }

  const quick = [
    { key: 'today', value: shortcuts.today, label: t('date.today') },
    { key: 'tomorrow', value: shortcuts.tomorrow, label: t('date.tomorrow') },
    { key: 'dayAfter', value: shortcuts.dayAfter, label: t('replan.dayAfter') },
    { key: 'nextWeek', value: shortcuts.nextWeek, label: t('date.nextWeek') },
  ];

  return (
    <>
      <Head onClose={onClose} progress={t('replan.progress', { index: position, count: total })} />

      <div className="sheet-body replan-body">
        <div className="replan-task">
          <p className="replan-name" dangerouslySetInnerHTML={{ __html: renderTitle(displayTaskContent(current)) }} />
          <p className="replan-meta">
            {was && (
              <span className={isLate ? 'late' : undefined}>
                <Icon name="calendar" size="sm" />
                {describe(was, dueTimeOf(current), true)}
              </span>
            )}
            {current.due?.is_recurring && <span><Icon name="repeat" size="sm" />{t('replan.recurring')}</span>}
            {project && <span><Icon name="project" size="sm" />{project}</span>}
            {parent && (
              <span className="replan-parent" title={displayTaskContent(parent)}>
                <Icon name="subtask" size="sm" />
                {t('replan.subtaskOf', { name: displayTaskContent(parent) })}
              </span>
            )}
          </p>
        </div>

        {!moving ? (
          <div className="replan-choices">
            {([
              { key: 'complete', icon: 'check', label: t('replan.complete'), hint: t('replan.completeHint'), run: () => void complete() },
              { key: 'move', icon: 'calendar', label: t('replan.move'), hint: t('replan.moveHint'), run: () => setMoving(true) },
              { key: 'skip', icon: 'arrow-right', label: t('replan.skip'), hint: t('replan.skipHint'), run: skip },
              { key: 'delete', icon: 'trash', label: t('replan.delete'), hint: t('replan.deleteHint'), run: () => void remove() },
            ] as const).map((choice, index) => (
              <button
                key={choice.key}
                type="button"
                className={`replan-choice ${choice.key}`}
                data-autofocus={index === 0 ? true : undefined}
                disabled={busy}
                onClick={choice.run}
              >
                <span className="replan-choice-icon" aria-hidden="true"><Icon name={choice.icon} /></span>
                <span className="replan-choice-text">
                  <b>{choice.label}</b>
                  <small>{choice.hint}</small>
                </span>
              </button>
            ))}
          </div>
        ) : (
          <div className="replan-move">
            <div className="replan-quick" role="group" aria-label={t('replan.quick')}>
              {quick.map((choice) => (
                <button
                  key={choice.key}
                  type="button"
                  className={`chip${date === choice.value ? ' on' : ''}`}
                  aria-pressed={date === choice.value}
                  onClick={() => setDate(choice.value)}
                >
                  {choice.label}
                </button>
              ))}
            </div>
            <div className="replan-when">
              <label>
                <span className="fieldlabel">{t('replan.date')}</span>
                <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
              </label>
              <label>
                <span className="fieldlabel">{t('replan.time')}</span>
                <input type="time" value={time} onChange={(e) => setTime(e.target.value)} />
              </label>
            </div>
            <label className="replan-reason">
              <span className="fieldlabel">
                <span className="replan-mark" aria-hidden="true">↻</span>
                {t('replan.reason')}
              </span>
              <textarea
                ref={reasonRef}
                data-autofocus
                rows={3}
                value={reason}
                placeholder={t('replan.reasonPlaceholder')}
                onChange={(e) => setReason(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void reschedule(); }
                }}
              />
              <span className="replan-hint">{t('replan.reasonHint')}</span>
            </label>
            {lateChildren.length > 0 && (
              <p className="replan-hint replan-children">
                <Icon name="subtask" size="sm" />
                {t('replan.childrenFollow', { count: lateChildren.length })}
              </p>
            )}
          </div>
        )}
      </div>

      <div className="sheet-foot">
        {moving ? (
          <>
            <button className="btn quiet" disabled={busy} onClick={() => setMoving(false)}>{t('replan.back')}</button>
            <button className="btn primary" disabled={busy || !text} onClick={() => void reschedule()}>
              {t('replan.confirmMove')}
            </button>
          </>
        ) : (
          <button className="btn quiet" onClick={onClose}>{t('replan.stop')}</button>
        )}
      </div>
    </>
  );
}

function Head({ onClose, progress }: { onClose: () => void; progress?: string }) {
  const { t } = useT();
  return (
    <div className="sheet-head">
      <h2>
        {t('replan.title')}
        {progress && <span className="replan-progress">{progress}</span>}
      </h2>
      <button className="iconbtn" aria-label={t('common.close')} onClick={onClose}>
        <Icon name="close" />
      </button>
    </div>
  );
}
