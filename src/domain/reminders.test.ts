import { describe, expect, it } from 'vitest';
import { GRACE_MS, plainTitle, upcomingReminders } from './reminders';
import type { Item, Reminder, Snapshot } from './types';
import { item } from '@/test/items';

// Wednesday 14 October 2026, 10:00 local time.
const now = new Date(2026, 9, 14, 10, 0).getTime();
const DAY = 24 * 60 * 60 * 1000;
const at = (h: number, m = 0, day = 14) => new Date(2026, 9, day, h, m).getTime();
const timed = (date: string) => ({ date, string: '', lang: 'en', timezone: null, is_recurring: false });

function snapshot(items: Item[], reminders: Reminder[] = [], userId = 'me'): Pick<Snapshot, 'items' | 'reminders' | 'user'> {
  return {
    items: Object.fromEntries(items.map((i) => [i.id, i])),
    reminders: Object.fromEntries(reminders.map((r) => [r.id, r])),
    user: { id: userId } as Snapshot['user'],
  };
}

describe('desktop notifications for due tasks', () => {
  it('reminds a timed task at its time', () => {
    const list = upcomingReminders(snapshot([item({ id: 'a', content: 'Call', due: timed('2026-10-14T14:00:00') })]), now, DAY);
    expect(list).toEqual([{ key: `a@${at(14)}`, itemId: 'a', at: at(14), title: 'Call', dueAt: at(14) }]);
  });

  it('never reminds a task with only a day', () => {
    expect(upcomingReminders(snapshot([item({ id: 'a', due: timed('2026-10-14') })]), now, DAY)).toEqual([]);
  });

  it('uses the reminders set in Todoist instead of the due time', () => {
    const task = item({ id: 'a', due: timed('2026-10-14T14:00:00') });
    const reminders: Reminder[] = [
      { id: 'r1', item_id: 'a', type: 'relative', due: null, minute_offset: 30, is_deleted: false },
      { id: 'r2', item_id: 'a', type: 'absolute', due: timed('2026-10-14T11:15:00'), is_deleted: false },
    ];
    expect(upcomingReminders(snapshot([task], reminders), now, DAY).map((r) => r.at)).toEqual([at(11, 15), at(13, 30)]);
  });

  it('reminds an untimed task only through an absolute reminder', () => {
    const task = item({ id: 'a', due: timed('2026-10-14') });
    const reminders: Reminder[] = [
      { id: 'r1', item_id: 'a', type: 'relative', due: null, minute_offset: 30, is_deleted: false },
      { id: 'r2', item_id: 'a', type: 'absolute', due: timed('2026-10-14T16:00:00'), is_deleted: false },
    ];
    expect(upcomingReminders(snapshot([task], reminders), now, DAY).map((r) => r.at)).toEqual([at(16)]);
  });

  it('skips done, deleted, other people’s, past and far-off tasks', () => {
    const items = [
      item({ id: 'done', checked: true, due: timed('2026-10-14T14:00:00') }),
      item({ id: 'gone', is_deleted: true, due: timed('2026-10-14T14:00:00') }),
      item({ id: 'theirs', responsible_uid: 'someone', due: timed('2026-10-14T14:00:00') }),
      item({ id: 'past', due: timed('2026-10-14T09:00:00') }),
      item({ id: 'far', due: timed('2026-10-20T09:00:00') }),
      item({ id: 'mine', responsible_uid: 'me', due: timed('2026-10-14T14:00:00') }),
    ];
    expect(upcomingReminders(snapshot(items), now, DAY).map((r) => r.itemId)).toEqual(['mine']);
  });

  it('still shows a reminder that is only just overdue', () => {
    const justNow = new Date(now - GRACE_MS / 2);
    const iso = `2026-10-14T${String(justNow.getHours()).padStart(2, '0')}:${String(justNow.getMinutes()).padStart(2, '0')}:00`;
    expect(upcomingReminders(snapshot([item({ id: 'a', due: timed(iso) })]), now, DAY)).toHaveLength(1);
  });

  it('ignores deleted reminders and location reminders', () => {
    const task = item({ id: 'a', due: timed('2026-10-14T14:00:00') });
    const reminders: Reminder[] = [
      { id: 'r1', item_id: 'a', type: 'relative', due: null, minute_offset: 30, is_deleted: true },
      { id: 'r2', item_id: 'a', type: 'location', due: null, is_deleted: false },
    ];
    // Neither counts as a reminder of its own, so the due time still reminds.
    expect(upcomingReminders(snapshot([task], reminders), now, DAY).map((r) => r.at)).toEqual([at(14)]);
  });

  it('shows the words of a title, not its formatting', () => {
    expect(plainTitle('**Read** [the brief](https://example.com) _today_')).toBe('Read the brief today');
  });
});
