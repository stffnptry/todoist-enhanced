/** The desktop app's answer to a calendar command. */
export type CalendarAnswer = { ok: boolean; error?: string; [key: string]: unknown };

/** One command to the Mac's calendars; outside the desktop app it simply fails. */
export const calendarCall = (command: string, input?: Record<string, unknown>): Promise<CalendarAnswer> =>
  window.enhancedDesktop?.calendar?.(command, input) ?? Promise.resolve({ ok: false, error: 'unavailable' });
