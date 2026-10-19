import { describe, expect, it } from 'vitest';
import { buildReport, movesIn, quickRange, reasonOf } from './report';
import type { CompletedItem, Note, Project } from './types';
import type { RescheduleEntry } from '@/lib/rescheduleLog';
import { due, item } from '@/test/items';

const now = new Date('2026-10-18T20:00:00');
const week = { since: new Date('2026-10-12T00:00:00'), until: new Date('2026-10-18T23:59:59.999') };

const done = (id: string, at: string, extra: Partial<CompletedItem> = {}): CompletedItem => ({
  id, task_id: id, user_id: 'me', project_id: 'p', section_id: null, content: `Task ${id}`, completed_at: at, ...extra,
});
const move = (taskId: string, at: string, from: string, to: string | null): RescheduleEntry => ({
  taskId, at, from, to, title: `Task ${taskId}`, projectId: 'p', labels: [], recurring: false,
});
const note = (id: string, itemId: string, at: string, content: string): Note => ({
  id, item_id: itemId, project_id: null, content, posted_at: at, posted_uid: 'me', is_deleted: false, file_attachment: null,
});
const projects: Record<string, Project> = {
  p: { id: 'p', name: 'Arbeit_Geplant' } as Project,
};

describe('reasonOf', () => {
  it('takes the text after the headline, even after a time', () => {
    expect(reasonOf('↻ Verschoben von 14. Okt. 2026 auf 19. Okt. 2026, 14:30: Keine Zeit')).toBe('Keine Zeit');
    expect(reasonOf('↻ Verschoben von 14. Okt., 09:00 auf 15. Okt.: Wartet: auf Max')).toBe('Wartet: auf Max');
  });
});

describe('movesIn', () => {
  it('gives a logged move the reason of a comment written at the same time', () => {
    const log = [move('a', '2026-10-14T09:00:00', '2026-10-14', '2026-10-15')];
    const notes = { n: note('n', 'a', '2026-10-14T08:59:30', '↻ Verschoben von 14. Okt. auf 15. Okt.: Krank') };
    const moves = movesIn(week, log, notes, {});
    expect(moves).toHaveLength(1);
    expect(moves[0].reason).toBe('Krank');
  });

  it('counts a comment without a logged move on its own', () => {
    const notes = { n: note('n', 'b', '2026-10-15T10:00:00', '↻ Verschoben: Urlaub') };
    const moves = movesIn(week, [], notes, { b: item({ id: 'b', content: 'Bericht' }) });
    expect(moves).toMatchObject([{ taskId: 'b', from: '', title: 'Bericht', reason: 'Urlaub' }]);
  });

  it('leaves out moves outside the range', () => {
    expect(movesIn(week, [move('a', '2026-10-01T09:00:00', '2026-10-01', '2026-10-02')], {}, {})).toEqual([]);
  });
});

describe('buildReport', () => {
  const items = {
    a: item({ id: 'a', content: 'Steuererklärung', due: due('2026-10-20') }),
    o: item({ id: 'o', content: 'Alt', due: due('2026-10-01') }),
  };
  const log = [
    move('a', '2026-10-13T09:00:00', '2026-10-13', '2026-10-14'),
    move('a', '2026-10-14T09:00:00', '2026-10-14', '2026-10-16'),
    move('a', '2026-10-16T09:00:00', '2026-10-16', '2026-10-20'),
    move('x', '2026-10-15T09:00:00', '2026-10-15', '2026-10-13'),
  ];
  const completed = [
    done('1', '2026-10-12T09:00:00', { due: due('2026-10-12') }),
    done('2', '2026-10-13T10:00:00', { due: due('2026-10-12') }),
    done('3', '2026-10-13T22:30:00'),
  ];
  const r = buildReport({ range: week, completed, previous: [done('9', '2026-10-06T09:00:00')], log, items, projects, notes: {}, now });

  it('counts what was finished and compares it', () => {
    expect(r.completed.count).toBe(3);
    expect(r.completed.change).toBe(200);
    expect(r.completed.onTime).toBe(1);
    expect(r.completed.late).toBe(1);
    expect(r.completed.byArea).toEqual([{ name: 'Arbeit', count: 3 }]);
    expect(r.completed.activeDays).toBe(2);
  });

  it('counts moves, their direction and the task moved most', () => {
    expect(r.moves).toMatchObject({ count: 4, tasks: 2, postponed: 3, pulledForward: 1, avgDaysPushed: 2.3 });
    expect(r.moves.top[0]).toMatchObject({ taskId: 'a', count: 3, daysPushed: 7, state: 'open' });
  });

  it('turns the numbers into learnings', () => {
    const ids = r.learnings.map((l) => l.id);
    expect(ids).toContain('overplanning');
    expect(ids).toContain('chronicMovers');
    expect(r.open.overdue).toBe(1);
  });

  it('compares plan and completion and draws patterns from it', () => {
    const tuesday = Array.from({ length: 4 }, (_, i) =>
      done(`t${i}`, `2026-10-13T1${i}:30:00`, { due: due('2026-10-13T09:00:00') }));
    const late = Array.from({ length: 3 }, (_, i) => done(`l${i}`, '2026-10-16T10:00:00', { due: due('2026-10-14') }));
    const completions = [
      { taskId: 'r', at: '2026-10-14T19:00:00', planned: '2026-10-14T18:00:00', title: 'Gießen', projectId: 'p', labels: [], recurring: true },
    ];
    const timed = buildReport({ range: week, completed: [...tuesday, ...late], previous: [], log: [], completions, items: {}, projects, notes: {}, now });
    expect(timed.completed.count).toBe(8);
    expect(timed.timing).toMatchObject({ late: 3, onDay: 5, timed: { count: 5, medianMinutes: 150 } });
    const ids = timed.learnings.map((l) => l.id);
    expect(ids).toContain('lateTimed');
    expect(ids).toContain('weakPlanDay');
    expect(timed.analysis.map((a) => a.id)).toContain('timingClockLater');
  });

  it('says so when there is nothing', () => {
    const empty = buildReport({ range: week, completed: [], previous: [], log: [], items: {}, projects, notes: {}, now });
    expect(empty.learnings.map((l) => l.id)).toEqual(['noData']);
  });
});

describe('quickRange', () => {
  it('names last week from the account’s first weekday', () => {
    const r = quickRange('lastWeek', null, 1, now);
    expect(r.since.toDateString()).toBe(new Date('2026-10-05T00:00:00').toDateString());
    expect(r.until.toDateString()).toBe(new Date('2026-10-11T00:00:00').toDateString());
  });

  it('reads the last 30 days up to today', () => {
    const r = quickRange('last30', null, 1, now);
    expect(r.since.toDateString()).toBe(new Date('2026-09-19T00:00:00').toDateString());
  });
});
