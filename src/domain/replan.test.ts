import { describe, expect, it } from 'vitest';
import {
  defaultReplanDate, dueTimeOf, isOverdue, overdueDescendants, isRescheduleComment, nextToReplan, replanShortcuts, rescheduleCommentText, RESCHEDULE_MARK,
} from './replan';
import { due, item } from '@/test/items';

describe('rescheduleCommentText', () => {
  it('starts with the mark and carries the reason', () => {
    expect(rescheduleCommentText('Verschoben von 18. Okt. auf 19. Okt.', '  Kein Strom  '))
      .toBe(`${RESCHEDULE_MARK} Verschoben von 18. Okt. auf 19. Okt.: Kein Strom`);
  });

  it('gives nothing without a reason', () => {
    expect(rescheduleCommentText('Verschoben', '   ')).toBeNull();
  });
});

describe('isRescheduleComment', () => {
  it('recognises the mark, also after leading space', () => {
    expect(isRescheduleComment('↻ Verschoben: weil')).toBe(true);
    expect(isRescheduleComment('  ↻ Moved: because')).toBe(true);
  });

  it('leaves ordinary comments alone', () => {
    expect(isRescheduleComment('Verschoben ↻')).toBe(false);
    expect(isRescheduleComment('')).toBe(false);
    expect(isRescheduleComment(undefined)).toBe(false);
  });
});

describe('nextToReplan', () => {
  const a = item({ id: 'a' });
  const b = item({ id: 'b' });
  const c = item({ id: 'c', checked: true });

  it('takes the first task not yet handled', () => {
    expect(nextToReplan([a, b], new Set())?.id).toBe('a');
    expect(nextToReplan([a, b], new Set(['a']))?.id).toBe('b');
  });

  it('skips ticked tasks and ends when all are handled', () => {
    expect(nextToReplan([c, b], new Set())?.id).toBe('b');
    expect(nextToReplan([a, b], new Set(['a', 'b']))).toBeUndefined();
  });
});

describe('replanShortcuts', () => {
  it('counts from the given day', () => {
    // Saturday, 18 October 2026.
    expect(replanShortcuts(new Date(2026, 9, 18, 15, 0))).toEqual({
      today: '2026-10-18',
      tomorrow: '2026-10-19',
      dayAfter: '2026-10-20',
      nextWeek: '2026-10-19',
    });
  });
});

describe('dueTimeOf', () => {
  it('reads the time of a timed task and nothing of a plain date', () => {
    expect(dueTimeOf(item({ due: due('2026-10-18T09:30:00') }))).toBe('09:30');
    expect(dueTimeOf(item({ due: due('2026-10-18') }))).toBe('');
    expect(dueTimeOf(item())).toBe('');
  });
});

describe('defaultReplanDate', () => {
  const now = new Date(2026, 9, 19, 10, 0);

  it('suggests today for overdue tasks', () => {
    expect(defaultReplanDate(item({ due: due('2026-10-16') }), now)).toBe('2026-10-19');
    expect(defaultReplanDate(item({ due: due('2026-10-19T08:00:00') }), now)).toBe('2026-10-19');
    expect(isOverdue(item({ due: due('2026-10-19T08:00:00') }), now)).toBe(true);
  });

  it('suggests tomorrow for tasks that are not overdue', () => {
    expect(defaultReplanDate(item({ due: due('2026-10-19') }), now)).toBe('2026-10-20');
    expect(defaultReplanDate(item({ due: due('2026-10-19T14:00:00') }), now)).toBe('2026-10-20');
    expect(defaultReplanDate(item(), now)).toBe('2026-10-20');
  });
});

describe('overdueDescendants', () => {
  const now = new Date(2026, 9, 19, 10, 0);
  const items = Object.fromEntries([
    item({ id: 'p', due: due('2026-10-16') }),
    item({ id: 'late', parent_id: 'p', due: due('2026-10-15') }),
    item({ id: 'deep', parent_id: 'late', due: due('2026-10-17T09:00:00') }),
    item({ id: 'later', parent_id: 'p', due: due('2026-10-25') }),
    item({ id: 'undated', parent_id: 'p' }),
    item({ id: 'done', parent_id: 'p', due: due('2026-10-15'), checked: true }),
    item({ id: 'other', due: due('2026-10-15') }),
  ].map((i) => [i.id, i]));

  it('finds open overdue subtasks at any depth and nothing else', () => {
    expect(overdueDescendants('p', items, now).map((i) => i.id).sort()).toEqual(['deep', 'late']);
  });

  it('gives nothing for a task without subtasks', () => {
    expect(overdueDescendants('other', items, now)).toEqual([]);
  });
});
