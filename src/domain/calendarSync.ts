import { linkedTaskId, type CalendarEvent } from './calendar';

/**
 * Keeping the tasks calendar in step with Todoist (desktop app).
 *
 * Every open task with a time has one event in the chosen calendar, as long
 * as its estimate. Only events that carry a Todoist task link are ever
 * touched; anything else in that calendar is the user's own and left alone.
 */

export interface WantedEvent {
  taskId: string;
  title: string;
  start: number;
  end: number;
}

export interface SyncPlan {
  create: WantedEvent[];
  update: Array<WantedEvent & { eventId: string }>;
  remove: string[];
}

/** Changes under a minute are noise from rounding, not a move. */
const SAME_MS = 60_000;

export function planCalendarSync(
  wanted: WantedEvent[],
  events: CalendarEvent[],
  taskState: (taskId: string) => 'open' | 'done' | 'gone',
  now: number,
): SyncPlan {
  const plan: SyncPlan = { create: [], update: [], remove: [] };
  const byTask = new Map<string, CalendarEvent[]>();
  for (const event of events) {
    const id = linkedTaskId(event);
    if (!id) continue;
    byTask.set(id, [...(byTask.get(id) ?? []), event]);
  }

  const wantedIds = new Set<string>();
  for (const want of wanted) {
    wantedIds.add(want.taskId);
    const existing = byTask.get(want.taskId) ?? [];
    if (existing.length === 0) {
      plan.create.push(want);
      continue;
    }
    // One event per task: keep the one nearest the wanted time, drop the rest.
    const [keep, ...extra] = [...existing].sort(
      (a, b) => Math.abs(new Date(a.start).getTime() - want.start) - Math.abs(new Date(b.start).getTime() - want.start),
    );
    plan.remove.push(...extra.map((e) => e.id));
    const moved = Math.abs(new Date(keep.start).getTime() - want.start) >= SAME_MS
      || Math.abs(new Date(keep.end).getTime() - want.end) >= SAME_MS;
    if (moved || keep.title !== want.title) plan.update.push({ ...want, eventId: keep.id });
  }

  for (const [taskId, linked] of byTask) {
    if (wantedIds.has(taskId)) continue;
    const state = taskState(taskId);
    for (const event of linked) {
      const past = new Date(event.start).getTime() <= now;
      /* An open task that lost its time: its event goes. A finished or vanished
         one keeps what already happened, as a record, and loses what was still
         ahead. (A task that disappears may have been completed: Todoist stops
         sending it either way, so the past is kept to be safe.) */
      if (state === 'open' || !past) plan.remove.push(event.id);
    }
  }
  return plan;
}
