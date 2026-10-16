import { addDays, differenceInCalendarDays, format, startOfDay } from 'date-fns';
import type { Item, Snapshot } from './types';
import { dueDate, hasTime } from './dates';
import { bucketOf } from './views';
import { plainTitle } from './reminders';
import { toDisplayPriority } from './types';
import type { CalendarEvent, CalendarInfo } from './calendar';
import type { DailyCapacity } from './load';

/**
 * Planning with Claude inside the desktop app: what Claude is told about the
 * account, and how its proposals come back.
 *
 * Claude only ever proposes. Each proposal names a task by its id from the
 * context; the panel shows them and applies the ones the person accepts.
 * Claude may also propose facts to remember about the person; those are only
 * kept (by the desktop app, in gedaechtnis.md) once the person agrees.
 */

export type PlanAction =
  | { type: 'schedule'; taskId: string; start: string; minutes: number }
  | { type: 'date'; taskId: string; date: string };

export interface PlannerInput {
  snapshot: Pick<Snapshot, 'items' | 'projects' | 'user'>;
  /** Open top-level tasks. */
  roots: Item[];
  minutesOf: (item: Item) => number | null;
  events: CalendarEvent[];
  calendars: CalendarInfo[];
  capacity: DailyCapacity;
  now: Date;
  /** The interface language, as a name ("Deutsch"), for the answer. */
  language: string;
  /** Whether accepted time blocks also go into a calendar. */
  calendarTarget: string | null;
}

const LANGUAGE_RULE = (language: string) =>
  `Answer in ${language}, addressing the user informally (du in German, tu in French). `
  + 'Be concise and concrete; use short lists, no long preambles. Refer to tasks by their title, '
  + 'never by their id: ids are only for the actions block.';

const hm = (minutes: number) => `${Math.floor(minutes / 60)}h${String(minutes % 60).padStart(2, '0')}`;

function taskLine(item: Item, input: PlannerInput): string {
  const project = input.snapshot.projects[item.project_id]?.name;
  const minutes = input.minutesOf(item);
  const due = dueDate(item);
  const parts = [
    `[${item.id}] ${plainTitle(item.content)}`,
    project ? `#${project}` : null,
    `P${toDisplayPriority(item.priority)}`,
    due ? `due ${format(due, hasTime(item.due) ? 'yyyy-MM-dd HH:mm' : 'yyyy-MM-dd')}${item.due?.is_recurring ? ` (repeats: ${item.due.string})` : ''}` : null,
    minutes !== null ? `estimate ${minutes} min` : 'no estimate',
    item.labels.length ? `labels: ${item.labels.join(', ')}` : null,
    item.deadline ? `deadline ${item.deadline.date}` : null,
  ];
  return `- ${parts.filter(Boolean).join(' | ')}`;
}

/** The instructions and the account as it stands, for --append-system-prompt. */
export function plannerSystemPrompt(input: PlannerInput): string {
  const { now, roots } = input;
  const today = startOfDay(now);
  const groups: Array<[string, Item[]]> = [
    ['Overdue', roots.filter((i) => bucketOf(i, now) === 'overdue')],
    ['Due today', roots.filter((i) => bucketOf(i, now) === 'today')],
    ['This week, no fixed day (week label)', roots.filter((i) => bucketOf(i, now) === 'anytime')],
    ['Due in the next 7 days', roots.filter((i) => {
      const d = dueDate(i);
      if (!d) return false;
      const days = differenceInCalendarDays(d, today);
      return days >= 1 && days <= 7;
    })],
    ['Inbox and undated (sample)', roots.filter((i) => !i.due && i.project_id === input.snapshot.user?.inbox_project_id).slice(0, 25)],
  ];

  const byId = new Map(input.calendars.map((c) => [c.id, c.title]));
  const events = input.events
    .filter((e) => new Date(e.end) > now && new Date(e.start) < addDays(today, 8))
    .sort((a, b) => a.start.localeCompare(b.start))
    .slice(0, 150)
    .map((e) => {
      const start = new Date(e.start);
      const end = new Date(e.end);
      const when = e.allDay
        ? `${format(start, 'EEE yyyy-MM-dd')} all day`
        : `${format(start, 'EEE yyyy-MM-dd HH:mm')}–${format(end, 'HH:mm')}`;
      return `- ${when} ${e.title}${byId.get(e.calendarId) ? ` (${byId.get(e.calendarId)})` : ''}`;
    });

  const capacity = Array.from({ length: 7 }, (_, i) => {
    const day = addDays(today, i);
    return `${format(day, 'EEE yyyy-MM-dd')}: ${hm(input.capacity[day.getDay()])}`;
  });

  return [
    'You are the planning assistant inside "Enhanced for Todoist", a desktop app on top of the user\'s Todoist account.',
    LANGUAGE_RULE(input.language),
    'You help plan the day and the week: what to do when, what to move, what to drop. Respect the capacity per day',
    '(time available for tasks after meetings) and the calendar events below; never plan tasks over events.',
    'Tasks without an estimate count as 30 minutes unless you say otherwise.',
    '',
    'When you propose concrete changes, end your answer with ONE fenced block in exactly this format:',
    '```actions',
    '[{"type":"schedule","taskId":"<id>","start":"YYYY-MM-DDTHH:mm","minutes":45},',
    ' {"type":"date","taskId":"<id>","date":"YYYY-MM-DD"}]',
    '```',
    '"schedule" gives a task a time block (start in local time, length in minutes);',
    `${input.calendarTarget ? 'accepted blocks are also written into the user\'s calendar.' : 'accepted blocks set the task\'s time in Todoist.'}`,
    '"date" moves a task to a day without a time. Only use task ids from the list below, never invent tasks,',
    'and never put anything else in that block. The user reviews and accepts each proposal; nothing changes before that,',
    'so never say a change is done: call it a proposal.',
    'Mention the proposals in plain words above the block too.',
    '',
    'You also build a memory of how the user plans: their habits, preferences and the patterns in their decisions.',
    'When you notice something lasting that would help future planning and is not in the memory yet, propose it',
    'at the very end of your answer (after the actions block, if any) in exactly this format:',
    '```memory',
    '- one short sentence per fact, in the language of your answer',
    '```',
    'At most three facts, only lasting ones (no one-off plans), never guesses. The user decides what is kept.',
    '',
    `Now: ${format(now, "EEEE yyyy-MM-dd HH:mm")} (local time). The user's week starts on day ${input.snapshot.user?.start_day ?? 1} (1 = Monday).`,
    '',
    'Capacity for tasks per day:',
    ...capacity,
    '',
    ...groups.flatMap(([title, items]) => (items.length ? [`${title} (${items.length}):`, ...items.slice(0, 80).map((i) => taskLine(i, input)), ''] : [])),
    events.length ? 'Calendar events (next 7 days):' : 'No calendar events available.',
    ...events,
  ].join('\n');
}

const ACTION_BLOCK = /```actions\s*\n([\s\S]*?)```/;
const MEMORY_BLOCK = /```memory\s*\n([\s\S]*?)```/;
const LOCAL_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Claude's answer split into what to show, what can be applied and what it
 * proposes to remember. Anything malformed, or naming a task that is not open,
 * is dropped rather than guessed.
 */
export function parsePlanAnswer(
  answer: string,
  isOpenTask: (id: string) => boolean,
): { text: string; actions: PlanAction[]; memory: string[] } {
  const match = MEMORY_BLOCK.exec(answer);
  const memory = match
    ? match[1].split('\n')
      .map((line) => line.replace(/^\s*[-*•]\s*/, '').trim())
      .filter((line) => line.length > 0 && line.length <= 300)
      .slice(0, 5)
    : [];
  return { ...parseActions(match ? answer.replace(MEMORY_BLOCK, '') : answer, isOpenTask), memory };
}

function parseActions(
  answer: string,
  isOpenTask: (id: string) => boolean,
): { text: string; actions: PlanAction[] } {
  const match = ACTION_BLOCK.exec(answer);
  if (!match) return { text: answer.trim(), actions: [] };
  const text = answer.replace(ACTION_BLOCK, '').trim();
  let raw: unknown;
  try {
    raw = JSON.parse(match[1]);
  } catch {
    return { text, actions: [] };
  }
  if (!Array.isArray(raw)) return { text, actions: [] };
  const actions: PlanAction[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue;
    const a = entry as Record<string, unknown>;
    const taskId = typeof a.taskId === 'string' ? a.taskId : '';
    if (!taskId || !isOpenTask(taskId)) continue;
    if (a.type === 'schedule' && typeof a.start === 'string' && LOCAL_TIME.test(a.start)) {
      const minutes = Math.round(Number(a.minutes));
      if (minutes > 0 && minutes <= 12 * 60) actions.push({ type: 'schedule', taskId, start: a.start.slice(0, 16), minutes });
    } else if (a.type === 'date' && typeof a.date === 'string' && DAY.test(a.date)) {
      actions.push({ type: 'date', taskId, date: a.date });
    }
  }
  return { text, actions };
}

/**
 * Lines for the decision log (claude-protokoll.md): which proposals the person
 * took (✓) and which they unticked (✗), so Claude can learn from the pattern.
 */
export function decisionLogLines(
  now: Date,
  entries: Array<{ name: string; when: string; accepted: boolean }>,
): string[] {
  const stamp = format(now, 'yyyy-MM-dd HH:mm');
  return entries.map((e) => `- ${stamp} ${e.accepted ? '✓' : '✗'} ${e.name} → ${e.when}`);
}

/** A local "YYYY-MM-DDTHH:mm" as a Date in the user's time zone. */
export function localDateTime(value: string): Date {
  const [day, time] = value.split('T');
  const [y, m, d] = day.split('-').map(Number);
  const [h, min] = time.split(':').map(Number);
  return new Date(y, m - 1, d, h, min);
}
