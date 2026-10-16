import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchCompleted } from '@/api/completed';
import { useStore } from '@/store/store';
import type { CompletedItem } from '@/domain/types';

const NONE: CompletedItem[] = [];
const DAY_MS = 24 * 60 * 60_000;
/** Erledigt wird oft vor dem geplanten Tag: so weit davor wird nachgesehen. */
const EARLY_DAYS = 14;
const EVERY_MS = 5 * 60_000;
/** Beim Zurückkehren ins Fenster höchstens so oft neu lesen. */
const FOCUS_GAP_MS = 60_000;

/**
 * Tasks done around the days the calendar shows, read from Todoist's history.
 *
 * The snapshot only keeps what was ticked off since the last full sync: after
 * the next one a done task would drop off the calendar. Its history keeps it,
 * with the date it had, so it stays where it was planned. Not in the demo
 * (its history has no times) and not offline.
 */
export function useCompletedAround(from: Date, to: Date): { items: CompletedItem[]; forget: (id: string) => void } {
  const connected = useStore((s) => s.connected);
  const demo = useStore((s) => s.demo);
  const fromMs = from.getTime();
  const toMs = to.getTime();
  const key = `${fromMs}:${toMs}`;
  const [loaded, setLoaded] = useState<{ key: string; items: CompletedItem[] }>({ key: '', items: NONE });
  const [round, setRound] = useState(0);
  const lastRead = useRef(0);

  useEffect(() => {
    if (!connected || demo) return undefined;
    const controller = new AbortController();
    const now = Date.now();
    // Done can be any time before now, but not after it.
    const since = new Date(Math.min(fromMs, now) - EARLY_DAYS * DAY_MS);
    const until = new Date(now + 60_000);
    lastRead.current = now;
    fetchCompleted(since, until, controller.signal)
      .then((items) => { if (!controller.signal.aborted) setLoaded({ key, items }); })
      .catch(() => { /* Ohne Verlauf zeigt der Kalender nur, was der Abgleich kennt. */ });
    return () => controller.abort();
  }, [key, fromMs, toMs, connected, demo, round]);

  useEffect(() => {
    const again = () => setRound((n) => n + 1);
    const timer = setInterval(again, EVERY_MS);
    const onFocus = () => { if (Date.now() - lastRead.current > FOCUS_GAP_MS) again(); };
    window.addEventListener('focus', onFocus);
    return () => { clearInterval(timer); window.removeEventListener('focus', onFocus); };
  }, []);

  /** Takes a task out at once (it was reopened), before the next read confirms it. */
  const forget = useCallback((id: string) => {
    setLoaded((current) => ({ ...current, items: current.items.filter((item) => (item.task_id ?? item.id) !== id) }));
  }, []);

  return { items: loaded.key === key ? loaded.items : NONE, forget };
}
