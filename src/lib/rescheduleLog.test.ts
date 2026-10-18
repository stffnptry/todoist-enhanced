import { describe, expect, it } from 'vitest';
import { mergeReschedules, reschedulesFrom, type RescheduleEntry } from './rescheduleLog';
import { emptySnapshot, type Item } from '@/domain/types';
import { updateItem } from '@/api/commands';
import { due, item } from '@/test/items';

const snap = (...items: Item[]) => ({ ...emptySnapshot(), items: Object.fromEntries(items.map((i) => [i.id, i])) });
const now = new Date('2026-10-18T10:00:00');

describe('reschedulesFrom', () => {
  it('records a task whose day changes', () => {
    const before = snap(item({ id: 'a', content: 'Steuer', due: due('2026-10-18') }));
    const after = snap(item({ id: 'a', content: 'Steuer', due: due('2026-10-20') }));
    const [entry] = reschedulesFrom(before, after, [updateItem('a', { due: { date: '2026-10-20' } })], now);
    expect(entry).toMatchObject({ taskId: 'a', from: '2026-10-18', to: '2026-10-20', title: 'Steuer' });
  });

  it('counts losing the date, but not getting one or a new time on the same day', () => {
    const before = snap(
      item({ id: 'a', due: due('2026-10-18') }),
      item({ id: 'b', due: null }),
      item({ id: 'c', due: due('2026-10-18T09:00:00') }),
    );
    const after = snap(
      item({ id: 'a', due: null }),
      item({ id: 'b', due: due('2026-10-19') }),
      item({ id: 'c', due: due('2026-10-18T15:00:00') }),
    );
    const cmds = ['a', 'b', 'c'].map((id) => updateItem(id, { due: null }));
    const out = reschedulesFrom(before, after, cmds, now);
    expect(out.map((e) => [e.taskId, e.to])).toEqual([['a', null]]);
  });

  it('ignores updates that do not touch the date', () => {
    const before = snap(item({ id: 'a', due: due('2026-10-18') }));
    const after = snap(item({ id: 'a', due: due('2026-10-19') }));
    expect(reschedulesFrom(before, after, [updateItem('a', { content: 'x' })], now)).toEqual([]);
  });
});

describe('mergeReschedules', () => {
  const entry = (at: string, from: string, to: string | null): RescheduleEntry => ({
    taskId: 'a', at, from, to, title: 'A', projectId: 'p', labels: [], recurring: false,
  });

  it('drops a move that is undone right away', () => {
    const log = [entry('2026-10-18T10:00:00Z', '2026-10-18', '2026-10-19')];
    expect(mergeReschedules(log, [entry('2026-10-18T10:01:00Z', '2026-10-19', '2026-10-18')], now)).toEqual([]);
  });

  it('keeps a move back much later as its own entry', () => {
    const log = [entry('2026-10-16T10:00:00Z', '2026-10-18', '2026-10-19')];
    expect(mergeReschedules(log, [entry('2026-10-18T09:00:00Z', '2026-10-19', '2026-10-18')], now)).toHaveLength(2);
  });

  it('forgets entries older than the kept window', () => {
    const log = [entry('2025-01-01T10:00:00Z', '2025-01-01', '2025-01-02')];
    expect(mergeReschedules(log, [], now)).toEqual([]);
  });
});
