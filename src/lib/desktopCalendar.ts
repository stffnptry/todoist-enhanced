import type { Item } from '@/domain/types';
import { plainTitle } from '@/domain/reminders';
import { todoistTaskUrl } from '@/api/links';

/** The desktop app's answer to a calendar command. */
export type CalendarAnswer = { ok: boolean; error?: string; [key: string]: unknown };

/** One command to the Mac's calendars; outside the desktop app it simply fails. */
export const calendarCall = (command: string, input?: Record<string, unknown>): Promise<CalendarAnswer> =>
  window.enhancedDesktop?.calendar?.(command, input) ?? Promise.resolve({ ok: false, error: 'unavailable' });

/** A task as an event: its title, its length, and a link back to it. */
export function createTaskEvent(item: Item, calendarId: string, start: Date, minutes: number): Promise<CalendarAnswer> {
  return calendarCall('create', {
    calendar: calendarId,
    title: plainTitle(item.content),
    start: start.toISOString(),
    end: new Date(start.getTime() + minutes * 60_000).toISOString(),
    notes: `Todoist: ${todoistTaskUrl(item.id)}`,
    url: todoistTaskUrl(item.id),
  });
}
