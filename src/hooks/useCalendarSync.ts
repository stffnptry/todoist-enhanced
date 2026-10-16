import { useEffect, useRef } from 'react';
import { addDays, startOfDay } from 'date-fns';
import { useStore } from '@/store/store';
import { useData } from '@/hooks/useData';
import { effectiveEstimate } from '@/domain/estimates';
import { dueDate, hasTime } from '@/domain/dates';
import { plainTitle } from '@/domain/reminders';
import { DEFAULT_TASK_MINUTES, linkedTaskId, type CalendarEvent } from '@/domain/calendar';
import { planCalendarSync, type WantedEvent } from '@/domain/calendarSync';
import { calendarCall } from '@/lib/desktopCalendar';
import { todoistTaskUrl } from '@/api/links';

/** How far back and ahead the calendar is kept in step. */
const PAST_DAYS = 7;
const AHEAD_DAYS = 60;
const EVERY_MS = 10 * 60_000;
/** Settle time after a change, so a burst of edits is one pass. */
const DEBOUNCE_MS = 2_000;

/** Whether tasks with a time are written into the calendar on their own. */
export const calendarSyncOn = (prefs: { calendarSync: boolean; calendarTarget: string | null }): boolean =>
  !!window.enhancedDesktop?.calendar && prefs.calendarSync && !!prefs.calendarTarget;

/** Ask for a pass now (after scheduling or moving a task), rather than at the next tick. */
export const requestCalendarSync = (): void => { window.dispatchEvent(new CustomEvent('enhanced:calendar-sync')); };

/**
 * Keeps the chosen calendar in step with the tasks that have a time (desktop
 * app). See domain/calendarSync for the rules; this runs them.
 */
export function useCalendarSync(): void {
  const { snapshot, childrenOf } = useData();
  const prefs = useStore((s) => s.prefs);
  const demo = useStore((s) => s.demo);
  const connected = useStore((s) => s.connected);
  /* The demo never writes into a real calendar: there it only runs against
     the desktop app's test calendar (see the status check below). */
  const on = calendarSyncOn(prefs) && (connected || demo) && !!snapshot.user;

  const latest = useRef({ childrenOf, target: prefs.calendarTarget });
  latest.current = { childrenOf, target: prefs.calendarTarget };
  const running = useRef(false);
  const again = useRef(false);

  useEffect(() => {
    if (!on) return undefined;

    const pass = async () => {
      if (running.current) { again.current = true; return; }
      running.current = true;
      try {
        /* Read the store itself, not the last render: a pass asked for right
           after a move must already see the task's new time. */
        const { childrenOf: children, target } = latest.current;
        const snap = useStore.getState().snapshot;
        if (!target || Object.keys(snap.items).length === 0) return;
        const status = await calendarCall('status');
        if (!status.granted) return;
        if (useStore.getState().demo && !status.fake) return;
        const now = Date.now();
        const from = addDays(startOfDay(new Date()), -PAST_DAYS);
        const to = addDays(startOfDay(new Date()), AHEAD_DAYS);
        const read = await calendarCall('events', { from: from.toISOString(), to: to.toISOString(), calendars: [target] });
        if (!read.ok) return;
        const events = ((read.events as CalendarEvent[]) ?? []).filter((e) => e.calendarId === target && !e.allDay);

        const me = snap.user?.id;
        const wanted: WantedEvent[] = [];
        for (const item of Object.values(snap.items)) {
          if (item.checked || item.is_deleted || !hasTime(item.due)) continue;
          if (item.responsible_uid && me && item.responsible_uid !== me) continue;
          const start = dueDate(item)!;
          if (start < from || start >= to) continue;
          const minutes = effectiveEstimate(item, children).minutes ?? DEFAULT_TASK_MINUTES;
          wanted.push({ taskId: item.id, title: plainTitle(item.content), start: start.getTime(), end: start.getTime() + minutes * 60_000 });
        }
        const plan = planCalendarSync(wanted, events, (id) => {
          const item = snap.items[id];
          if (!item || item.is_deleted) return 'gone';
          return item.checked ? 'done' : 'open';
        }, now);

        /* A pass that would clear out much of the calendar at once is more
           likely a glitch (data half loaded) than the user's doing: it adds and
           moves, but removes nothing this time. */
        const linked = events.filter((e) => linkedTaskId(e)).length;
        const removeAllowed = plan.remove.length <= Math.max(10, linked / 2);

        let changed = false;
        for (const w of plan.create) {
          const answer = await calendarCall('create', {
            calendar: target, title: w.title,
            start: new Date(w.start).toISOString(), end: new Date(w.end).toISOString(),
            notes: `Todoist: ${todoistTaskUrl(w.taskId)}`, url: todoistTaskUrl(w.taskId),
          });
          changed ||= answer.ok;
        }
        for (const u of plan.update) {
          const answer = await calendarCall('update', {
            id: u.eventId, title: u.title,
            start: new Date(u.start).toISOString(), end: new Date(u.end).toISOString(),
          });
          changed ||= answer.ok;
        }
        if (removeAllowed) {
          for (const id of plan.remove) {
            const answer = await calendarCall('delete', { id });
            changed ||= answer.ok;
          }
        }
        if (changed) window.dispatchEvent(new CustomEvent('enhanced:calendar-changed'));
      } finally {
        running.current = false;
        if (again.current) { again.current = false; void pass(); }
      }
    };

    const timer = setInterval(() => void pass(), EVERY_MS);
    const onRequest = () => void pass();
    window.addEventListener('enhanced:calendar-sync', onRequest);
    return () => { clearInterval(timer); window.removeEventListener('enhanced:calendar-sync', onRequest); };
  }, [on]);

  // Every change to the tasks starts a pass once the edits settle.
  useEffect(() => {
    if (!on) return undefined;
    const timer = setTimeout(requestCalendarSync, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [on, snapshot.items, prefs.calendarTarget]);
}
