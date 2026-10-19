import { describe, expect, it } from 'vitest';
import { missingCompletions, plannedOf, timingOf } from './planVsActual';
import type { CompletedItem } from './types';
import type { CompletionEntry } from '@/lib/completionLog';
import type { RescheduleEntry } from '@/lib/rescheduleLog';
import { due } from '@/test/items';

const done = (id: string, at: string, extra: Partial<CompletedItem> = {}): CompletedItem => ({
  id: `c-${id}-${at}`, task_id: id, user_id: 'me', project_id: 'p', section_id: null, content: `Task ${id}`, completed_at: at, ...extra,
});
const logged = (taskId: string, at: string, planned: string | null, recurring = false): CompletionEntry => ({
  taskId, at, planned, title: `Task ${taskId}`, projectId: 'p', labels: [], recurring,
});
const move = (taskId: string, at: string, from: string, to: string): RescheduleEntry => ({
  taskId, at, from, to, title: `Task ${taskId}`, projectId: 'p', labels: [], recurring: false,
});
const area = (c: CompletedItem) => (c.project_id === 'w' ? 'Arbeit' : 'Privat');

describe('plannedOf', () => {
  it('prefers the logged plan, then the date Todoist reports', () => {
    const c = done('a', '2026-10-14T10:00:00', { due: due('2026-10-20') });
    expect(plannedOf(c, [logged('a', '2026-10-14T10:02:00', '2026-10-13')])).toBe('2026-10-13');
    expect(plannedOf(c, [])).toBe('2026-10-20');
    expect(plannedOf(done('b', '2026-10-14T10:00:00'), [])).toBeNull();
  });

  it('does not trust a recurring task whose date already moved past the completion', () => {
    const c = done('r', '2026-10-14T10:00:00', { due: due('2026-10-21', { is_recurring: true }) });
    expect(plannedOf(c, [])).toBeUndefined();
  });
});

describe('missingCompletions', () => {
  it('adds logged completions Todoist does not list', () => {
    const range = { since: new Date('2026-10-12T00:00:00'), until: new Date('2026-10-18T23:59:59') };
    const completed = [done('a', '2026-10-14T10:00:00')];
    const log = [
      logged('a', '2026-10-14T10:00:30', '2026-10-14'),
      logged('r', '2026-10-15T08:00:00', '2026-10-15', true),
      logged('x', '2026-10-01T08:00:00', '2026-10-01'),
    ];
    const extra = missingCompletions(completed, log, range);
    expect(extra.map((c) => [c.task_id, c.due?.date, c.due?.is_recurring])).toEqual([['r', '2026-10-15', true]]);
  });
});

describe('timingOf', () => {
  const items = [
    done('early', '2026-10-12T09:00:00', { due: due('2026-10-13') }),
    done('day', '2026-10-13T18:00:00', { due: due('2026-10-13'), project_id: 'w' }),
    done('late', '2026-10-16T09:00:00', { due: due('2026-10-13'), project_id: 'w' }),
    done('timed', '2026-10-14T10:45:00', { due: due('2026-10-14T10:00:00') }),
    done('spont', '2026-10-14T11:00:00'),
  ];
  const moves = [
    move('late', '2026-10-10T09:00:00', '2026-10-11', '2026-10-12'),
    move('late', '2026-10-12T09:00:00', '2026-10-12', '2026-10-13'),
  ];
  const t = timingOf(items, [], moves, area);

  it('sorts completions into early, on the day, late and unplanned', () => {
    expect(t).toMatchObject({ early: 1, onDay: 2, late: 1, unplanned: 1, avgLateDays: 3, maxLateDays: 3 });
  });

  it('measures how far a time was missed', () => {
    expect(t.timed).toEqual({ count: 1, medianMinutes: 45, close: 0, later: 1, earlier: 0 });
  });

  it('remembers the first plan before the task was moved', () => {
    const row = t.rows.find((r) => r.taskId === 'late')!;
    expect(row).toMatchObject({ original: '2026-10-11', originalDiff: 5, moves: 2 });
    expect(t.moved).toEqual({ count: 1, avgExtraDays: 5 });
  });

  it('counts by planned weekday and area', () => {
    // 2026-10-13 ist ein Dienstag: drei geplant, zwei gehalten.
    expect(t.byPlannedWeekday[2]).toEqual({ planned: 3, kept: 2 });
    expect(t.byArea).toEqual([
      { name: 'Privat', planned: 2, kept: 2, late: 0 },
      { name: 'Arbeit', planned: 2, kept: 1, late: 1 },
    ]);
  });

  it('only counts moves of the current occurrence of a recurring task', () => {
    const occurrences = [
      done('r', '2026-10-12T09:00:00', { id: 'r1' }),
      done('r', '2026-10-15T09:00:00', { id: 'r2' }),
    ];
    const log = [logged('r', '2026-10-12T09:00:00', '2026-10-12', true), logged('r', '2026-10-15T09:00:00', '2026-10-14', true)];
    const rMoves = [move('r', '2026-10-11T09:00:00', '2026-10-11', '2026-10-12'), move('r', '2026-10-13T09:00:00', '2026-10-13', '2026-10-14')];
    const rows = timingOf(occurrences, log, rMoves, area).rows;
    expect(rows.map((r) => [r.planned, r.original, r.dayDiff])).toEqual([
      ['2026-10-12', '2026-10-11', 0],
      ['2026-10-14', '2026-10-13', 1],
    ]);
  });
});
