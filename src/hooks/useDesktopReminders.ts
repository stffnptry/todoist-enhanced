import { useEffect, useRef } from 'react';
import { useStore } from '@/store/store';
import { SNOOZE_MINUTES, snoozedDue, upcomingReminders, type ReminderAction } from '@/domain/reminders';
import type { Item } from '@/domain/types';
import { formatTime } from '@/domain/dates';
import { translate } from '@/i18n';

/** A week ahead is plenty: the list is sent again whenever the data changes. */
const HORIZON_MS = 7 * 24 * 60 * 60 * 1000;
/** Sent again now and then, so a reminder that has passed leaves the list. */
const RESEND_MS = 10 * 60 * 1000;
/** How long a button pressed on a notification waits for the data, when the window has just been opened. */
const LOAD_WAIT_MS = 60 * 1000;

/** The task once the data has it: right away, or as soon as a sync brings it. */
function whenLoaded(id: string): Promise<Item | undefined> {
  const found = useStore.getState().snapshot.items[id];
  if (found) return Promise.resolve(found);
  return new Promise((resolve) => {
    const timer = setTimeout(() => { stop(); resolve(undefined); }, LOAD_WAIT_MS);
    const stop = useStore.subscribe((state) => {
      const item = state.snapshot.items[id];
      if (!item) return;
      clearTimeout(timer);
      stop();
      resolve(item);
    });
  });
}

/** A button on a notification: done, or later. A task already done or gone is left alone. */
async function runAction(id: string, action: ReminderAction): Promise<void> {
  const item = await whenLoaded(id);
  if (!item || item.checked || item.is_deleted) return;
  const { toggleTask, updateTask } = useStore.getState();
  if (action === 'done') await toggleTask(id);
  else await updateTask(id, { due: snoozedDue(item.due, Date.now(), SNOOZE_MINUTES[action]) });
}

const isAction = (value: unknown): value is ReminderAction =>
  value === 'done' || value === 'snooze15' || value === 'snooze60';

/**
 * Hands the desktop app the notifications to show for due tasks, opens a
 * task when one of them is clicked, and carries out the buttons on them
 * (done, +15 min, +1 hour). Does nothing in a browser, in the
 * quick-add window (it never mounts the main shell), or in the demo.
 */
export function useDesktopReminders(openTask: (id: string) => void): void {
  const items = useStore((s) => s.snapshot.items);
  const reminders = useStore((s) => s.snapshot.reminders);
  const user = useStore((s) => s.snapshot.user);
  const on = useStore((s) => s.prefs.desktopReminders);
  const locale = useStore((s) => s.prefs.locale);
  const hour12 = useStore((s) => s.prefs.hour12);
  const demo = useStore((s) => s.demo);

  useEffect(() => {
    const desktop = window.enhancedDesktop;
    if (!desktop?.setReminders) return undefined;
    const send = () => {
      if (!on || demo) {
        desktop.setReminders?.([]);
        return;
      }
      const list = upcomingReminders({ items, reminders, user }, Date.now(), HORIZON_MS).map((r) => ({
        key: r.key,
        itemId: r.itemId,
        at: r.at,
        title: r.title,
        body: r.dueAt !== null
          ? translate(locale, 'reminder.dueAt', { time: formatTime(new Date(r.dueAt), locale, hour12) })
          : translate(locale, 'reminder.body'),
        actions: [
          translate(locale, 'reminder.actionDone'),
          translate(locale, 'reminder.actionSnooze15'),
          translate(locale, 'reminder.actionSnooze60'),
        ],
        closeText: translate(locale, 'reminder.close'),
      }));
      desktop.setReminders?.(list);
    };
    send();
    const timer = setInterval(send, RESEND_MS);
    return () => clearInterval(timer);
  }, [items, reminders, user, on, demo, locale, hour12]);

  // A click on a notification: the desktop app brings the window up and says which task.
  const open = useRef(openTask);
  open.current = openTask;
  useEffect(() => {
    const onOpen = (event: Event) => {
      const id = (event as CustomEvent<unknown>).detail;
      if (typeof id === 'string') open.current(id);
    };
    const onAction = (event: Event) => {
      const detail = (event as CustomEvent<{ itemId?: unknown; action?: unknown } | null>).detail;
      if (detail && typeof detail.itemId === 'string' && isAction(detail.action)) void runAction(detail.itemId, detail.action);
    };
    window.addEventListener('enhanced:open-task', onOpen);
    window.addEventListener('enhanced:task-action', onAction);
    return () => {
      window.removeEventListener('enhanced:open-task', onOpen);
      window.removeEventListener('enhanced:task-action', onAction);
    };
  }, []);
}
