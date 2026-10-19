import { describe, expect, it } from 'vitest';
import { completionsFrom, mergeCompletions, reopenedBy, type CompletionEntry } from './completionLog';
import { emptySnapshot, type Item } from '@/domain/types';
import { command, completeItem, uncompleteItem, updateItem } from '@/api/commands';
import { due, item } from '@/test/items';

const snap = (...items: Item[]) => ({ ...emptySnapshot(), items: Object.fromEntries(items.map((i) => [i.id, i])) });
const now = new Date('2026-10-18T10:00:00');
const entry = (taskId: string, at: string): CompletionEntry => ({
  taskId, at, planned: null, title: taskId, projectId: 'p', labels: [], recurring: false,
});

describe('completionsFrom', () => {
  it('keeps the plan the task had when it was ticked off, also for recurring tasks', () => {
    const before = snap(
      item({ id: 'a', content: 'Steuer', due: due('2026-10-17T09:00:00') }),
      item({ id: 'r', content: 'Gießen', due: due('2026-10-18', { is_recurring: true }) }),
      item({ id: 'n', content: 'Ohne', due: null }),
    );
    const out = completionsFrom(before, [completeItem('a'), command('item_close', { id: 'r' }), completeItem('n')], now);
    expect(out.map((e) => [e.taskId, e.planned, e.recurring])).toEqual([
      ['a', '2026-10-17T09:00:00', false],
      ['r', '2026-10-18', true],
      ['n', null, false],
    ]);
    expect(out[0].at).toBe(now.toISOString());
  });

  it('ignores other commands and tasks that are already done', () => {
    const before = snap(item({ id: 'a', checked: true }), item({ id: 'b' }));
    expect(completionsFrom(before, [completeItem('a'), updateItem('b', { content: 'x' })], now)).toEqual([]);
  });
});

describe('mergeCompletions', () => {
  it('drops a completion that is undone right away, but not an old one', () => {
    const log = [entry('a', '2026-10-10T10:00:00'), entry('b', '2026-10-18T09:59:00')];
    const next = mergeCompletions(log, [], reopenedBy([uncompleteItem('a'), uncompleteItem('b')]), now);
    expect(next.map((e) => e.taskId)).toEqual(['a']);
  });

  it('forgets entries older than 400 days', () => {
    const next = mergeCompletions([entry('old', '2025-01-01T10:00:00')], [entry('new', now.toISOString())], [], now);
    expect(next.map((e) => e.taskId)).toEqual(['new']);
  });
});
