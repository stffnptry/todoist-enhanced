import { useEffect, useRef } from 'react';
import { useStore } from '@/store/store';
import { upcomingReminders } from '@/domain/reminders';
import { formatTime } from '@/domain/dates';
import { translate } from '@/i18n';

/** A week ahead is plenty: the list is sent again whenever the data changes. */
const HORIZON_MS = 7 * 24 * 60 * 60 * 1000;
/** Sent again now and then, so a reminder that has passed leaves the list. */
const RESEND_MS = 10 * 60 * 1000;

/**
 * Hands the desktop app the notifications to show for due tasks, and opens a
 * task when one of them is clicked. Does nothing in a browser, in the
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
    window.addEventListener('enhanced:open-task', onOpen);
    return () => window.removeEventListener('enhanced:open-task', onOpen);
  }, []);
}
