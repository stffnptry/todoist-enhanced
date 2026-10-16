import { describe, expect, it } from 'vitest';
import { dueBucket, effortBucket, groupTasks, layoutDay, linkedTaskId, onDay, snapMinutes } from './calendar';

const day = new Date(2026, 9, 14);
const at = (h: number, m = 0) => new Date(2026, 9, 14, h, m);

describe('the calendar grid', () => {
  it('snaps drops to quarter hours inside the day', () => {
    expect(snapMinutes(9 * 60 + 7)).toBe(9 * 60);
    expect(snapMinutes(9 * 60 + 8)).toBe(9 * 60 + 15);
    expect(snapMinutes(-20)).toBe(0);
    expect(snapMinutes(24 * 60 + 30)).toBe(24 * 60 - 15);
  });

  it('puts overlapping events side by side and lone ones full width', () => {
    const placed = layoutDay([
      { item: 'a', start: at(9), end: at(10) },
      { item: 'b', start: at(9, 30), end: at(11) },
      { item: 'c', start: at(10), end: at(10, 30) },
      { item: 'd', start: at(14), end: at(15) },
    ], day);
    const by = Object.fromEntries(placed.map((p) => [p.item, p]));
    expect([by.a.column, by.b.column, by.c.column]).toEqual([0, 1, 0]);
    expect([by.a.columns, by.b.columns, by.c.columns]).toEqual([2, 2, 2]);
    expect([by.d.column, by.d.columns]).toEqual([0, 1]);
    expect([by.a.top, by.a.bottom]).toEqual([540, 600]);
  });

  it('clips an event that runs over midnight to the day', () => {
    const [placed] = layoutDay([{ item: 'x', start: new Date(2026, 9, 13, 23), end: at(1) }], day);
    expect([placed.top, placed.bottom]).toEqual([0, 60]);
  });

  it('knows which task an event came from', () => {
    expect(linkedTaskId({ url: 'https://app.todoist.com/app/task/6abc123', notes: '' })).toBe('6abc123');
    expect(linkedTaskId({ url: '', notes: 'Todoist: https://app.todoist.com/app/task/42' })).toBe('42');
    expect(linkedTaskId({ url: 'https://example.com', notes: '' })).toBeNull();
  });

  it('places all-day events on each day they cover', () => {
    const allDay = { start: new Date(2026, 9, 14).toISOString(), end: new Date(2026, 9, 16).toISOString(), allDay: true };
    expect(onDay(allDay, new Date(2026, 9, 14))).toBe(true);
    expect(onDay(allDay, new Date(2026, 9, 15))).toBe(true);
    expect(onDay(allDay, new Date(2026, 9, 16))).toBe(false);
  });
});

describe('the task list beside the calendar', () => {
  const now = new Date(2026, 9, 14, 10, 0);
  const weekEnd = new Date(2026, 9, 18, 23, 59);
  type T = { id: string; due: Date | null; timed?: boolean; project: string; order: number; p: number; min: number | null };
  const read = {
    due: (t: T) => dueBucket(t.due, !!t.timed, now, weekEnd),
    dueAt: (t: T) => t.due?.getTime() ?? Infinity,
    project: (t: T) => ({ key: t.project, order: t.order }),
    priority: (t: T) => t.p,
    minutes: (t: T) => t.min,
    title: (t: T) => t.id,
  };
  const tasks: T[] = [
    { id: 'a', due: new Date(2026, 9, 13), project: 'Work', order: 2, p: 2, min: 30 },
    { id: 'b', due: new Date(2026, 9, 14, 9), timed: true, project: 'Home', order: 1, p: 1, min: 10 },
    { id: 'c', due: new Date(2026, 9, 14, 16), timed: true, project: 'Work', order: 2, p: 4, min: 90 },
    { id: 'd', due: new Date(2026, 9, 16), project: 'Home', order: 1, p: 1, min: null },
    { id: 'e', due: new Date(2026, 10, 2), project: 'Work', order: 2, p: 3, min: 45 },
    { id: 'f', due: null, project: 'Inbox', order: 0, p: 4, min: 5 },
  ];
  const shape = (mode: Parameters<typeof groupTasks>[1], sort?: Parameters<typeof groupTasks>[3]) =>
    groupTasks(tasks, mode, read, sort).map((g) => `${g.key}:${g.items.map((t) => t.id).join('')}`);

  it('groups by due date, soonest first, P1 first inside', () => {
    expect(shape('due')).toEqual(['overdue:ba', 'today:c', 'week:d', 'later:e', 'none:f']);
  });
  it('groups by project in the project’s own place (the default way)', () => {
    expect(shape('project')).toEqual(['Inbox:f', 'Home:bd', 'Work:aec']);
  });
  it('groups by priority, P1 first', () => {
    expect(shape('priority')).toEqual(['p1:bd', 'p2:a', 'p3:e', 'p4:cf']);
  });
  it('groups by effort, shortest first', () => {
    expect(shape('estimate', { by: 'estimate', descending: false })).toEqual(['quick:fb', 'short:ae', 'long:c', 'none:d']);
    expect(effortBucket(15)).toBe('quick');
    expect(effortBucket(61)).toBe('long');
  });
  it('sorts without groups, either way, missing values last', () => {
    expect(shape('none')).toEqual(['all:bdaecf']);
    expect(shape('none', { by: 'priority', descending: false })).toEqual(['all:cfeabd']);
    expect(shape('none', { by: 'estimate', descending: false })).toEqual(['all:fbaecd']);
    expect(shape('none', { by: 'estimate', descending: true })).toEqual(['all:ceabfd']);
    expect(shape('none', { by: 'due', descending: false })).toEqual(['all:abcdef']);
    expect(shape('none', { by: 'title', descending: true })).toEqual(['all:fedcba']);
  });
});
