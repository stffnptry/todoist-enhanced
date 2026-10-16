import { parseISO } from 'date-fns';
import type { Item, Snapshot } from './types';
import { hasTime } from './dates';

/**
 * When the desktop app should put up a notification, worked out from the
 * account's data.
 *
 * Two sources, the way Todoist's own apps remind: every reminder set in
 * Todoist (an absolute moment, or minutes before a timed task), and, for a
 * timed task with no reminder of its own, the moment it is due. A task with
 * only a day and no time never notifies: at midnight that would be every task
 * of the day at once. Location reminders need a phone and are left out.
 */
export interface ScheduledReminder {
  /** Unique per task and moment, so the same reminder is never shown twice. */
  key: string;
  itemId: string;
  /** Epoch milliseconds. */
  at: number;
  title: string;
  /** The moment the task is due, when it has a time: for the line under the title. */
  dueAt: number | null;
}

/** A reminder this long overdue is still shown: the app may have been asleep. */
export const GRACE_MS = 2 * 60 * 1000;

const isOpen = (item: Item | undefined): item is Item =>
  !!item && !item.checked && !item.is_deleted;

/** Not somebody else's task: unassigned, or assigned to the person signed in. */
const isMine = (item: Item, userId: string | undefined): boolean =>
  !item.responsible_uid || !userId || item.responsible_uid === userId;

/** "[Text](url)" and the markers Todoist allows in a title, reduced to the words. */
export function plainTitle(content: string): string {
  return content
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/(\*\*|__|\*|_|~~|`)/g, '')
    .trim();
}

const dueMoment = (item: Item): number | null =>
  item.due && hasTime(item.due) ? parseISO(item.due.date).getTime() : null;

export function upcomingReminders(
  snapshot: Pick<Snapshot, 'items' | 'reminders' | 'user'>,
  now: number,
  horizonMs: number,
): ScheduledReminder[] {
  const userId = snapshot.user?.id;
  const out: ScheduledReminder[] = [];
  const withReminder = new Set<string>();
  const add = (item: Item, at: number) => {
    if (Number.isNaN(at) || at < now - GRACE_MS || at > now + horizonMs) return;
    out.push({ key: `${item.id}@${at}`, itemId: item.id, at, title: plainTitle(item.content), dueAt: dueMoment(item) });
  };

  for (const reminder of Object.values(snapshot.reminders)) {
    if (reminder.is_deleted) continue;
    const item = snapshot.items[reminder.item_id];
    if (!isOpen(item) || !isMine(item, userId)) continue;
    if (reminder.type === 'absolute' && reminder.due && hasTime(reminder.due)) {
      withReminder.add(item.id);
      add(item, parseISO(reminder.due.date).getTime());
    } else if (reminder.type === 'relative') {
      withReminder.add(item.id);
      const due = dueMoment(item);
      if (due !== null) add(item, due - (reminder.minute_offset ?? 0) * 60_000);
    }
  }

  for (const item of Object.values(snapshot.items)) {
    if (!isOpen(item) || !isMine(item, userId) || withReminder.has(item.id)) continue;
    const due = dueMoment(item);
    if (due !== null) add(item, due);
  }

  return out.sort((a, b) => a.at - b.at);
}
