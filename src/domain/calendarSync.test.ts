import { describe, expect, it } from 'vitest';
import { planCalendarSync, type WantedEvent } from './calendarSync';
import type { CalendarEvent } from './calendar';

const now = new Date(2026, 9, 14, 10).getTime();
const h = (hours: number) => new Date(2026, 9, 14, hours).getTime();
const link = (id: string) => `https://app.todoist.com/app/task/${id}`;
const event = (id: string, taskId: string | null, start: number, end: number, title = 'T'): CalendarEvent => ({
  id, calendarId: 'todoist', title, start: new Date(start).toISOString(), end: new Date(end).toISOString(),
  allDay: false, location: '', notes: '', url: taskId ? link(taskId) : '',
});
const want = (taskId: string, start: number, end: number, title = 'T'): WantedEvent => ({ taskId, title, start, end });

describe('keeping the Todoist calendar in step', () => {
  it('creates an event for a timed task that has none', () => {
    const plan = planCalendarSync([want('a', h(14), h(15))], [], () => 'open', now);
    expect(plan.create.map((w) => w.taskId)).toEqual(['a']);
    expect(plan.update).toEqual([]);
    expect(plan.remove).toEqual([]);
  });

  it('moves, resizes or renames an event only when something changed', () => {
    const events = [event('e1', 'a', h(14), h(15)), event('e2', 'b', h(16), h(17))];
    const plan = planCalendarSync(
      [want('a', h(14), h(15)), want('b', h(16), h(16) + 30 * 60_000, 'Renamed')],
      events, () => 'open', now,
    );
    expect(plan.create).toEqual([]);
    expect(plan.update.map((u) => [u.eventId, u.title])).toEqual([['e2', 'Renamed']]);
  });

  it('keeps one event per task and removes duplicates', () => {
    const events = [event('e1', 'a', h(9), h(10)), event('e2', 'a', h(14), h(15))];
    const plan = planCalendarSync([want('a', h(14), h(15))], events, () => 'open', now);
    expect(plan.remove).toEqual(['e1']);
    expect(plan.update).toEqual([]);
  });

  it('removes the event of a task that lost its time', () => {
    const plan = planCalendarSync([], [event('e1', 'a', h(14), h(15))], () => 'open', now);
    expect(plan.remove).toEqual(['e1']);
  });

  it('keeps the past of finished or vanished tasks and drops their future', () => {
    const events = [
      event('past-done', 'a', h(8), h(9)), event('future-done', 'b', h(15), h(16)),
      event('past-gone', 'c', h(7), h(8)), event('future-gone', 'd', h(18), h(19)),
    ];
    const state = (id: string) => (id === 'a' || id === 'b' ? 'done' : 'gone') as 'done' | 'gone';
    expect(planCalendarSync([], events, state, now).remove).toEqual(['future-done', 'future-gone']);
  });

  it('never touches events that are not from a task', () => {
    const plan = planCalendarSync([], [event('mine', null, h(14), h(15))], () => 'gone', now);
    expect(plan).toEqual({ create: [], update: [], remove: [] });
  });
});
