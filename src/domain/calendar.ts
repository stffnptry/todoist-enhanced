/**
 * The calendar view of the desktop app: events read from the Mac's calendars
 * (through the desktop app's helper), laid out on a week grid, and tasks
 * dropped onto it.
 */

export interface CalendarInfo {
  id: string;
  title: string;
  color: string;
  /** The account it belongs to, e.g. "Google", "iCloud", "Exchange". */
  source: string;
  writable: boolean;
  subscribed: boolean;
}

export interface CalendarEvent {
  id: string;
  calendarId: string;
  title: string;
  /** ISO times. */
  start: string;
  end: string;
  allDay: boolean;
  location: string;
  notes: string;
  url: string;
}

/** Minutes a task without an estimate takes on the calendar. */
export const DEFAULT_TASK_MINUTES = 30;
/** Drops land on quarter hours. */
export const SNAP_MINUTES = 15;

/** The Todoist task an event was made from, read from its link. */
export function linkedTaskId(event: Pick<CalendarEvent, 'url' | 'notes'>): string | null {
  const match = /todoist\.com\/app\/task\/([\w-]+)/.exec(`${event.url} ${event.notes}`);
  return match ? match[1] : null;
}

/** A pointer position in a day column, as minutes after midnight, snapped. */
export function snapMinutes(minutes: number, step = SNAP_MINUTES): number {
  const snapped = Math.round(minutes / step) * step;
  return Math.max(0, Math.min(24 * 60 - step, snapped));
}

export interface PlacedEvent<T> {
  item: T;
  /** Minutes after the day's midnight, clipped to the day. */
  top: number;
  bottom: number;
  /** Side-by-side position among the events it overlaps. */
  column: number;
  columns: number;
}

/**
 * Lays out one day's timed events: each overlapping cluster is split into
 * columns, every event in the first column where it fits.
 */
export function layoutDay<T>(
  entries: Array<{ item: T; start: Date; end: Date }>,
  day: Date,
): Array<PlacedEvent<T>> {
  const midnight = new Date(day.getFullYear(), day.getMonth(), day.getDate()).getTime();
  const minute = (d: Date) => (d.getTime() - midnight) / 60_000;
  const placed = entries
    .map((e) => ({
      item: e.item,
      top: Math.max(0, minute(e.start)),
      // A zero-length event still gets a sliver to click.
      bottom: Math.min(24 * 60, Math.max(minute(e.end), minute(e.start) + SNAP_MINUTES)),
      column: 0,
      columns: 1,
    }))
    .filter((e) => e.bottom > 0 && e.top < 24 * 60)
    .sort((a, b) => a.top - b.top || b.bottom - a.bottom);

  let cluster: typeof placed = [];
  let clusterEnd = -1;
  const close = () => {
    const columns = Math.max(1, ...cluster.map((e) => e.column + 1));
    for (const e of cluster) e.columns = columns;
    cluster = [];
  };
  for (const event of placed) {
    if (event.top >= clusterEnd) {
      close();
      clusterEnd = -1;
    }
    const ends: number[] = [];
    for (const other of cluster) ends[other.column] = Math.max(ends[other.column] ?? -1, other.bottom);
    let column = 0;
    while (ends[column] !== undefined && ends[column] > event.top) column += 1;
    event.column = column;
    cluster.push(event);
    clusterEnd = Math.max(clusterEnd, event.bottom);
  }
  close();
  return placed;
}

/** Whether an event touches a calendar day (all-day events end at the next midnight). */
export function onDay(event: Pick<CalendarEvent, 'start' | 'end' | 'allDay'>, day: Date): boolean {
  const from = new Date(day.getFullYear(), day.getMonth(), day.getDate()).getTime();
  const to = from + 24 * 60 * 60_000;
  const start = new Date(event.start).getTime();
  const end = new Date(event.end).getTime();
  return start < to && (end > from || (end === start && start >= from));
}

/* ---------- Tasks on the grid ---------- */

export interface TaskBlock<T> {
  task: T;
  start: Date;
  done: boolean;
  /** A finished occurrence of a recurring task, which itself moved on. */
  occurrence?: boolean;
}

/**
 * The tasks drawn on the grid: every task with a time inside [from, to), open
 * or done, each once. A done task can come twice (still in the snapshot,
 * ticked, and again in Todoist's history), and a task reopened since is in
 * the open list and the history at once: the open one wins, wherever its
 * time now is.
 */
export function taskBlocks<T extends { id: string }>(
  open: T[],
  done: T[],
  startOf: (task: T) => Date | null,
  from: Date,
  to: Date,
): Array<TaskBlock<T>> {
  const seen = new Set<string>();
  const blocks: Array<TaskBlock<T>> = [];
  const add = (task: T, isDone: boolean) => {
    if (seen.has(task.id)) return;
    seen.add(task.id);
    const start = startOf(task);
    if (start && start >= from && start < to) blocks.push({ task, start, done: isDone });
  };
  for (const task of open) add(task, false);
  for (const task of done) add(task, true);
  return blocks;
}

/* ---------- The task list beside the grid ---------- */

export const TASK_GROUPS = ['none', 'project', 'due', 'priority', 'estimate'] as const;
export type TaskGroupMode = (typeof TASK_GROUPS)[number];
export const TASK_SORTS = ['priority', 'due', 'estimate', 'title'] as const;
export type TaskSortMode = (typeof TASK_SORTS)[number];

/** Where a task falls in each way of ordering the list. */
export type DueBucket = 'overdue' | 'today' | 'week' | 'later' | 'none';
export type EffortBucket = 'quick' | 'short' | 'long' | 'none';

export function dueBucket(due: Date | null, timed: boolean, now: Date, weekEnd: Date): DueBucket {
  if (!due) return 'none';
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const tomorrow = new Date(today.getTime() + 24 * 60 * 60_000);
  // A timed task is late from its minute on, a dated one from the next day.
  if (timed ? due.getTime() < now.getTime() : due < today) return 'overdue';
  if (due < tomorrow) return 'today';
  if (due <= weekEnd) return 'week';
  return 'later';
}

export function effortBucket(minutes: number | null): EffortBucket {
  if (minutes === null) return 'none';
  if (minutes <= 15) return 'quick';
  if (minutes <= 60) return 'short';
  return 'long';
}

export interface TaskGroup<T> {
  key: string;
  items: T[];
}

/**
 * The tasks in groups, in the order the groups read best (soonest first, a
 * project's own place, P1 first, shortest first), each group sorted as asked.
 *
 * "Descending" reads as people say it: priority descending is P1 first, a
 * date descending is the latest first, effort descending the longest first.
 * Ties fall back to priority, then date, then title.
 */
export function groupTasks<T>(
  tasks: T[],
  mode: TaskGroupMode,
  read: {
    due: (task: T) => DueBucket;
    dueAt: (task: T) => number;
    project: (task: T) => { key: string; order: number };
    priority: (task: T) => number; // 1 = P1 … 4 = P4
    minutes: (task: T) => number | null;
    title: (task: T) => string;
  },
  sort: { by: TaskSortMode; descending: boolean } = { by: 'priority', descending: true },
): Array<TaskGroup<T>> {
  const groups = new Map<string, { order: number; items: T[] }>();
  const put = (key: string, order: number, task: T) => {
    const group = groups.get(key) ?? { order, items: [] };
    group.items.push(task);
    groups.set(key, group);
  };
  const DUE_ORDER: DueBucket[] = ['overdue', 'today', 'week', 'later', 'none'];
  const EFFORT_ORDER: EffortBucket[] = ['quick', 'short', 'long', 'none'];
  for (const task of tasks) {
    if (mode === 'none') put('all', 0, task);
    else if (mode === 'due') put(read.due(task), DUE_ORDER.indexOf(read.due(task)), task);
    else if (mode === 'project') { const p = read.project(task); put(p.key, p.order, task); }
    else if (mode === 'priority') put(`p${read.priority(task)}`, read.priority(task), task);
    else { const b = effortBucket(read.minutes(task)); put(b, EFFORT_ORDER.indexOf(b), task); }
  }
  /* Each key ascending in its natural sense: P1 before P4, sooner before later,
     shorter before longer, A before Z. Missing dates and estimates always last. */
  const keyOf: Record<TaskSortMode, (task: T) => number | string | null> = {
    priority: (task) => read.priority(task),
    due: (task) => { const at = read.dueAt(task); return Number.isFinite(at) && at < Number.MAX_SAFE_INTEGER ? at : null; },
    estimate: (task) => read.minutes(task),
    title: (task) => read.title(task).toLocaleLowerCase(),
  };
  const compareBy = (by: TaskSortMode, a: T, b: T, flip: boolean): number => {
    const x = keyOf[by](a);
    const y = keyOf[by](b);
    if (x === null || y === null) return x === y ? 0 : x === null ? 1 : -1;
    const base = typeof x === 'string' ? x.localeCompare(y as string) : x - (y as number);
    return flip ? -base : base;
  };
  // Priority reads the other way round: "descending" is the most important first.
  const flip = sort.by === 'priority' ? !sort.descending : sort.descending;
  const within = (a: T, b: T) =>
    compareBy(sort.by, a, b, flip)
    || compareBy('priority', a, b, false)
    || compareBy('due', a, b, false)
    || compareBy('title', a, b, false);
  return [...groups.entries()]
    .sort(([ka, a], [kb, b]) => a.order - b.order || ka.localeCompare(kb))
    .map(([key, group]) => ({ key, items: group.items.sort(within) }));
}
