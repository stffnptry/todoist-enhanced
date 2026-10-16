import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type DragEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { addDays, format, isSameDay, startOfDay } from 'date-fns';
import { Icon } from '@/components/Icon';
import { useT } from '@/hooks/useT';
import { useData } from '@/hooks/useData';
import { useStore } from '@/store/store';
import { rootItems } from '@/store/selectors';
import { effectiveEstimate, formatDuration } from '@/domain/estimates';
import { hasTime, dueDate, formatTime, toApiDateTime, weekBounds } from '@/domain/dates';
import { dueForDate } from '@/domain/recurrence';
import { plainTitle } from '@/domain/reminders';
import { calendarSyncOn, requestCalendarSync } from '@/hooks/useCalendarSync';
import { todoistTaskUrl } from '@/api/links';
import { intlLocale, type TranslationKey } from '@/i18n';
import { toDisplayPriority } from '@/domain/types';
import {
  DEFAULT_TASK_MINUTES, SNAP_MINUTES, TASK_GROUPS, TASK_SORTS, type TaskGroupMode, type TaskSortMode, dueBucket, groupTasks, layoutDay, linkedTaskId, onDay, snapMinutes,
  type CalendarEvent, type CalendarInfo,
} from '@/domain/calendar';
import type { Item } from '@/domain/types';

/** The height of an hour is the user's (⌘ + scroll), between these. */
const MIN_HOUR_PX = 28;
const MAX_HOUR_PX = 180;
/** Colours offered per calendar: Todoist's own, in a usable order. */
const CALENDAR_PALETTE = [
  '#db4035', '#ff9933', '#fad000', '#7ecc49', '#299438', '#6accbc',
  '#14aaf5', '#4073ff', '#884dff', '#af38eb', '#e05194', '#808080',
];
const DAY_MINUTES = 24 * 60;

type Access = 'checking' | 'granted' | 'notDetermined' | 'denied' | 'unavailable';

/** What is being dragged: a task from the list (or its dashed block), or a task's event. */
type Drag =
  | { kind: 'task'; item: Item; minutes: number; offset: number }
  | { kind: 'event'; event: CalendarEvent; minutes: number; offset: number };

type Answer = { ok: boolean; error?: string; [key: string]: unknown };
type GridEntry = { kind: 'event'; event: CalendarEvent } | { kind: 'task'; task: Item };

const call = (command: string, input?: Record<string, unknown>): Promise<Answer> =>
  window.enhancedDesktop?.calendar?.(command, input) ?? Promise.resolve({ ok: false, error: 'unavailable' });

/**
 * The week as the Mac's calendars see it, with the week's tasks beside it.
 *
 * A task dragged onto the grid becomes an event in the calendar chosen as
 * target, as long as its estimate (30 minutes without one), and the task gets
 * the same time in Todoist, so its reminder follows. Only events made from a
 * task can be dragged again: meetings and the like are never moved from here.
 */
export function CalendarView({ onOpen }: { onOpen: (id: string) => void }) {
  const { t, locale } = useT();
  const { snapshot, items, childrenOf } = useData();
  const hour12 = useStore((s) => s.prefs.hour12);
  const calendarIds = useStore((s) => s.prefs.calendarIds);
  const target = useStore((s) => s.prefs.calendarTarget);
  const prefs = useStore((s) => s.prefs);
  const setPrefs = useStore((s) => s.setPrefs);
  const updateTask = useStore((s) => s.updateTask);
  const setEstimates = useStore((s) => s.setEstimates);
  const toast = useStore((s) => s.toast);

  const [access, setAccess] = useState<Access>(window.enhancedDesktop?.calendar ? 'checking' : 'unavailable');
  const [calendars, setCalendars] = useState<CalendarInfo[]>([]);
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [anchor, setAnchor] = useState(() => new Date());
  const [panel, setPanel] = useState(false);
  const [selected, setSelected] = useState<{ event: CalendarEvent } | null>(null);
  const [hover, setHover] = useState<{ day: number; minute: number; minutes: number } | null>(null);
  const [now, setNow] = useState(() => new Date());
  const drag = useRef<Drag | null>(null);
  /** The element being dragged, faded while it is. */
  const dragged = useRef<HTMLElement | null>(null);
  const scroller = useRef<HTMLDivElement>(null);

  /* ---------- Zoom: ⌘ + scroll (or a pinch) stretches the day ---------- */
  const savedHourPx = useStore((s) => s.prefs.calendarHourPx);
  const [hourPx, setHourPx] = useState(savedHourPx);
  const px = (minutes: number) => (minutes / 60) * hourPx;
  const zoomRef = useRef(hourPx);
  zoomRef.current = hourPx;
  /** The minute under the pointer when zooming, and where it was on screen: it stays put. */
  const zoomAnchor = useRef<{ minute: number; offset: number } | null>(null);
  const zoomTo = useCallback((next: number, anchor?: { minute: number; offset: number }) => {
    const clamped = Math.round(Math.min(MAX_HOUR_PX, Math.max(MIN_HOUR_PX, next)));
    if (clamped === zoomRef.current) return;
    zoomAnchor.current = anchor ?? (scroller.current
      ? { minute: ((scroller.current.scrollTop + scroller.current.clientHeight / 2) / zoomRef.current) * 60, offset: scroller.current.clientHeight / 2 }
      : null);
    setHourPx(clamped);
  }, []);
  useLayoutEffect(() => {
    const anchor = zoomAnchor.current;
    if (!anchor || !scroller.current) return;
    scroller.current.scrollTop = (anchor.minute / 60) * hourPx - anchor.offset;
    zoomAnchor.current = null;
  }, [hourPx]);
  // Kept in the account's settings once the zooming stops, not on every step.
  useEffect(() => {
    if (hourPx === savedHourPx) return undefined;
    const timer = setTimeout(() => setPrefs({ calendarHourPx: hourPx }), 700);
    return () => clearTimeout(timer);
  }, [hourPx, savedHourPx, setPrefs]);

  /* Week, today, or today and tomorrow: the span decides the first day and how many follow. */
  const span = useStore((s) => s.prefs.calendarSpan);
  const dayCount = span === 'week' ? 7 : span === 'two' ? 2 : 1;
  const firstDay = useMemo(
    () => (span === 'week' ? weekBounds(anchor, snapshot.user?.start_day ?? 1).start : startOfDay(anchor)),
    [span, anchor, snapshot.user?.start_day],
  );
  const week = useMemo(() => ({ start: firstDay }), [firstDay]);
  const days = useMemo(() => Array.from({ length: dayCount }, (_, i) => addDays(firstDay, i)), [firstDay, dayCount]);
  const step = (direction: 1 | -1) => setAnchor((d) => addDays(d, direction * dayCount));
  const byId = useMemo(() => new Map(calendars.map((c) => [c.id, c])), [calendars]);
  /* The target calendar is always read and shown: the tasks live there, and a
     task is drawn once, as its event, only when that event is in view. */
  const shownIds = useMemo(() => {
    const chosen = (calendarIds ?? calendars.map((c) => c.id)).filter((id) => byId.has(id));
    return target && byId.has(target) && !chosen.includes(target) ? [...chosen, target] : chosen;
  }, [calendarIds, calendars, byId, target]);
  const colors = useStore((s) => s.prefs.calendarColors);
  /** A calendar's colour: the one chosen here, else its own. */
  const colorOf = (id: string | undefined): string | undefined => (id ? colors[id] ?? byId.get(id)?.color : undefined);
  const [picking, setPicking] = useState<string | null>(null);
  const targetCalendar = target ? byId.get(target) : undefined;

  /* ---------- Reading ---------- */

  const checkAccess = useCallback(async () => {
    if (!window.enhancedDesktop?.calendar) return;
    const answer = await call('access');
    const status = String(answer.status ?? (answer.granted ? 'granted' : 'denied'));
    setAccess(answer.granted ? 'granted' : status === 'notDetermined' ? 'notDetermined' : 'denied');
  }, []);

  useEffect(() => { void checkAccess(); }, [checkAccess]);

  useEffect(() => {
    if (access !== 'granted') return;
    void call('calendars').then((answer) => {
      if (answer.ok) setCalendars((answer.calendars as CalendarInfo[]) ?? []);
    });
  }, [access]);

  const loadEvents = useCallback(async () => {
    if (access !== 'granted' || calendars.length === 0) return;
    setLoading(true);
    const answer = await call('events', {
      from: week.start.toISOString(),
      to: addDays(week.start, dayCount).toISOString(),
      calendars: shownIds,
    });
    setLoading(false);
    if (answer.ok) setEvents((answer.events as CalendarEvent[]) ?? []);
  }, [access, calendars.length, week.start, dayCount, shownIds]);

  useEffect(() => {
    void loadEvents();
    const timer = setInterval(() => { void loadEvents(); setNow(new Date()); }, 2 * 60_000);
    const onChanged = () => { void loadEvents(); };
    window.addEventListener('enhanced:calendar-changed', onChanged);
    const onFocus = () => { void loadEvents(); setNow(new Date()); };
    window.addEventListener('focus', onFocus);
    return () => {
      clearInterval(timer);
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('enhanced:calendar-changed', onChanged);
    };
  }, [loadEvents]);

  // Opened on the working day: the grid starts scrolled to seven in the morning.
  useEffect(() => {
    if (access === 'granted' && scroller.current) scroller.current.scrollTop = (7 * zoomRef.current) - 8;
  }, [access]);

  useEffect(() => {
    const element = scroller.current;
    if (access !== 'granted' || !element) return undefined;
    const onWheel = (event: WheelEvent) => {
      // ⌘ + wheel, or a trackpad pinch (which arrives as ctrl + wheel).
      if (!event.metaKey && !event.ctrlKey) return;
      event.preventDefault();
      const rect = element.getBoundingClientRect();
      const offset = event.clientY - rect.top;
      const minute = ((element.scrollTop + offset) / zoomRef.current) * 60;
      zoomTo(zoomRef.current * Math.exp(-event.deltaY * (event.ctrlKey ? 0.01 : 0.002)), { minute, offset });
    };
    element.addEventListener('wheel', onWheel, { passive: false });
    return () => element.removeEventListener('wheel', onWheel);
  }, [access, zoomTo]);

  /* ---------- Tasks ---------- */

  const minutesOf = useCallback(
    (item: Item) => effectiveEstimate(item, childrenOf).minutes ?? null,
    [childrenOf],
  );
  const linked = useMemo(() => new Set(events.map(linkedTaskId).filter((id): id is string => !!id)), [events]);
  const roots = useMemo(() => rootItems(items), [items]);
  /* Every open task, ordered the way the list is set to; a filter narrows it by title. */
  const tasksOpen = useStore((s) => s.prefs.calendarTasksOpen);
  const groupMode = useStore((s) => s.prefs.calendarGroupBy);
  const sortBy = useStore((s) => s.prefs.calendarSortBy);
  const sortDesc = useStore((s) => s.prefs.calendarSortDesc);
  const [query, setQuery] = useState('');
  const groups = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const shown = needle ? roots.filter((i) => plainTitle(i.content).toLowerCase().includes(needle)) : roots;
    const weekEnd = addDays(startOfDay(now), 7);
    return groupTasks(shown, groupMode, {
      due: (i) => dueBucket(dueDate(i), hasTime(i.due), now, weekEnd),
      dueAt: (i) => dueDate(i)?.getTime() ?? Number.MAX_SAFE_INTEGER,
      project: (i) => {
        const project = snapshot.projects[i.project_id];
        return { key: project?.name ?? '—', order: i.project_id === snapshot.user?.inbox_project_id ? -1 : project?.child_order ?? 0 };
      },
      priority: (i) => toDisplayPriority(i.priority),
      minutes: (i) => minutesOf(i),
      title: (i) => plainTitle(i.content),
    }, { by: sortBy, descending: sortDesc });
  }, [roots, query, groupMode, sortBy, sortDesc, now, snapshot.projects, snapshot.user?.inbox_project_id, minutesOf]);
  const groupTitle = (key: string): string => {
    if (groupMode === 'due') return t(`cal.bucket.${key}` as TranslationKey);
    if (groupMode === 'estimate') return t(`cal.effort.${key}` as TranslationKey);
    if (groupMode === 'priority') return key.toUpperCase();
    return key;
  };
  /* Tasks with a time this week that no event stands for yet: drawn dashed, so
     the plan shows them, and dragged like any other task to put them in. */
  const timedTasks = useMemo(
    () => roots.filter((i) => hasTime(i.due) && !linked.has(i.id)).map((i) => ({ item: i, start: dueDate(i)! }))
      .filter(({ start }) => start >= week.start && start < addDays(week.start, dayCount)),
    [roots, linked, week.start, dayCount],
  );

  /* ---------- Writing ---------- */

  const timeLabel = (date: Date) =>
    `${new Intl.DateTimeFormat(intlLocale(locale), { weekday: 'short', day: 'numeric', month: 'short' }).format(date)} ${formatTime(date, locale, hour12)}`;

  const syncOn = useStore((s) => calendarSyncOn(s.prefs));
  const schedule = async (item: Item, start: Date, minutes: number) => {
    if (!targetCalendar || !targetCalendar.writable) {
      toast(t('cal.targetNone'), undefined, { tone: 'error' });
      setPanel(true);
      return;
    }
    /* With the calendar kept in step, the task's time is all that changes:
       the next pass writes the event (as long as the estimate). */
    if (syncOn) {
      void updateTask(item.id, { due: dueForDate(item.due, toApiDateTime(start)) });
      toast(t('cal.scheduled', { name: plainTitle(item.content), time: timeLabel(start) }));
      requestCalendarSync();
      return;
    }
    const end = new Date(start.getTime() + minutes * 60_000);
    const answer = await call('create', {
      calendar: targetCalendar.id,
      title: plainTitle(item.content),
      start: start.toISOString(),
      end: end.toISOString(),
      notes: `Todoist: ${todoistTaskUrl(item.id)}`,
      url: todoistTaskUrl(item.id),
    });
    if (!answer.ok) {
      toast(t('cal.failed', { reason: String(answer.error ?? '') }), undefined, { tone: 'error' });
      return;
    }
    void updateTask(item.id, { due: dueForDate(item.due, toApiDateTime(start)) });
    toast(t('cal.scheduled', { name: plainTitle(item.content), time: timeLabel(start) }));
    void loadEvents();
  };

  const move = async (event: CalendarEvent, start: Date) => {
    const length = new Date(event.end).getTime() - new Date(event.start).getTime();
    const end = new Date(start.getTime() + length);
    // Shown at once where it was dropped; the calendar's answer follows.
    setEvents((list) => list.map((e) => (e.id === event.id ? { ...e, start: start.toISOString(), end: end.toISOString() } : e)));
    const answer = await call('update', { id: event.id, start: start.toISOString(), end: end.toISOString() });
    if (!answer.ok) {
      toast(t('cal.failed', { reason: String(answer.error ?? '') }), undefined, { tone: 'error' });
      void loadEvents();
      return;
    }
    const taskId = linkedTaskId(event);
    const item = taskId ? snapshot.items[taskId] : undefined;
    if (item && !item.checked) void updateTask(item.id, { due: dueForDate(item.due, toApiDateTime(start)) });
    if (syncOn) requestCalendarSync();
    toast(t('cal.moved', { name: event.title, time: timeLabel(start) }));
    void loadEvents();
  };

  const remove = async (event: CalendarEvent) => {
    setSelected(null);
    const answer = await call('delete', { id: event.id });
    if (!answer.ok) {
      toast(t('cal.failed', { reason: String(answer.error ?? '') }), undefined, { tone: 'error' });
      return;
    }
    toast(t('cal.removed'));
    void loadEvents();
  };

  const createTasksCalendar = async () => {
    const answer = await call('create-calendar', { title: t('cal.createdName') });
    if (!answer.ok) {
      toast(t('cal.failed', { reason: String(answer.error ?? '') }), undefined, { tone: 'error' });
      return;
    }
    const created = answer.calendar as CalendarInfo;
    setCalendars((list) => [...list, created]);
    setPrefs({ calendarTarget: created.id, ...(calendarIds ? { calendarIds: [...calendarIds, created.id] } : {}) });
    toast(t('cal.created', { name: created.title, source: created.source }));
  };

  /* ---------- Resizing a task's event: its length is the task's estimate ---------- */

  const [resize, setResize] = useState<{ eventId: string; top: number; bottom: number } | null>(null);
  const resizing = useRef(false);
  const justResized = useRef(false);

  const beginResize = (pointer: ReactPointerEvent, event: CalendarEvent, edge: 'top' | 'bottom', day: Date) => {
    pointer.preventDefault();
    pointer.stopPropagation();
    const column = (pointer.currentTarget as HTMLElement).closest('.cal-col') as HTMLElement | null;
    if (!column) return;
    const midnight = startOfDay(day).getTime();
    const startMin = (new Date(event.start).getTime() - midnight) / 60_000;
    const endMin = (new Date(event.end).getTime() - midnight) / 60_000;
    resizing.current = true;
    let current = { top: startMin, bottom: endMin };
    setResize({ eventId: event.id, ...current });

    const onMove = (move: PointerEvent) => {
      const rect = column.getBoundingClientRect();
      const raw = ((move.clientY - rect.top) / zoomRef.current) * 60;
      const minute = Math.max(0, Math.min(DAY_MINUTES, Math.round(raw / SNAP_MINUTES) * SNAP_MINUTES));
      current = edge === 'bottom'
        ? { top: current.top, bottom: Math.max(current.top + SNAP_MINUTES, minute) }
        : { top: Math.min(current.bottom - SNAP_MINUTES, minute), bottom: current.bottom };
      setResize({ eventId: event.id, ...current });
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      resizing.current = false;
      justResized.current = true;
      setTimeout(() => { justResized.current = false; }, 0);
      setResize(null);
      if (current.top === startMin && current.bottom === endMin) return;
      void applyResize(event, new Date(midnight + current.top * 60_000), new Date(midnight + current.bottom * 60_000));
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  const applyResize = async (event: CalendarEvent, start: Date, end: Date) => {
    setEvents((list) => list.map((e) => (e.id === event.id ? { ...e, start: start.toISOString(), end: end.toISOString() } : e)));
    const answer = await call('update', { id: event.id, start: start.toISOString(), end: end.toISOString() });
    if (!answer.ok) {
      toast(t('cal.failed', { reason: String(answer.error ?? '') }), undefined, { tone: 'error' });
      void loadEvents();
      return;
    }
    const taskId = linkedTaskId(event);
    const item = taskId ? snapshot.items[taskId] : undefined;
    const minutes = Math.round((end.getTime() - start.getTime()) / 60_000);
    if (item && !item.checked) {
      void setEstimates([{ id: item.id, minutes }]);
      if (start.getTime() !== new Date(event.start).getTime()) {
        void updateTask(item.id, { due: dueForDate(item.due, toApiDateTime(start)) });
      }
    }
    toast(t('cal.resized', { name: event.title, duration: formatDuration(minutes, locale) }));
    if (syncOn) requestCalendarSync();
  };

  /* ---------- Dragging ---------- */

  /* The browser's own drag picture is a snapshot of the screen around the
     element, neighbours and all: on a crowded day that drags half the column
     along. A small card of its own, made for the moment, is all that moves. */
  const dragPicture = (event: DragEvent, title: string, minutes: number, color?: string) => {
    const card = document.createElement('div');
    card.className = 'cal-dragcard';
    if (color) card.style.setProperty('--ev', color);
    const name = document.createElement('strong');
    name.textContent = title;
    const length = document.createElement('span');
    length.textContent = formatDuration(minutes, locale);
    card.append(name, length);
    document.body.append(card);
    event.dataTransfer.setDragImage(card, 12, 12);
    dragged.current = event.currentTarget as HTMLElement;
    dragged.current.classList.add('dragging');
    // Taken as a picture when the drag starts; the element itself can go.
    requestAnimationFrame(() => card.remove());
  };

  const startTaskDrag = (event: DragEvent, item: Item, grabbedAt = 0) => {
    const minutes = minutesOf(item) ?? DEFAULT_TASK_MINUTES;
    drag.current = { kind: 'task', item, minutes, offset: grabbedAt };
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', plainTitle(item.content));
    dragPicture(event, plainTitle(item.content), minutes);
  };

  const startEventDrag = (dragEvent: DragEvent, event: CalendarEvent) => {
    if (resizing.current) { dragEvent.preventDefault(); return; }
    const rect = (dragEvent.currentTarget as HTMLElement).getBoundingClientRect();
    const minutes = (new Date(event.end).getTime() - new Date(event.start).getTime()) / 60_000;
    drag.current = { kind: 'event', event, minutes, offset: ((dragEvent.clientY - rect.top) / hourPx) * 60 };
    dragEvent.dataTransfer.effectAllowed = 'move';
    dragEvent.dataTransfer.setData('text/plain', event.title);
    dragPicture(dragEvent, event.title, minutes, colorOf(event.calendarId));
  };

  const pointerMinute = (event: DragEvent) => {
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    const offset = drag.current?.offset ?? 0;
    return snapMinutes(((event.clientY - rect.top) / hourPx) * 60 - offset);
  };

  const onDragOver = (event: DragEvent, dayIndex: number) => {
    if (!drag.current) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    const minute = pointerMinute(event);
    if (!hover || hover.day !== dayIndex || hover.minute !== minute) {
      setHover({ day: dayIndex, minute, minutes: drag.current.minutes });
    }
  };

  const onDrop = (event: DragEvent, dayIndex: number) => {
    event.preventDefault();
    const current = drag.current;
    endDrag();
    if (!current) return;
    const start = new Date(days[dayIndex].getTime() + pointerMinute(event) * 60_000);
    if (current.kind === 'task') void schedule(current.item, start, current.minutes);
    else void move(current.event, start);
  };

  const endDrag = () => {
    drag.current = null;
    setHover(null);
    dragged.current?.classList.remove('dragging');
    dragged.current = null;
  };

  /* An event opens in a panel like an opened task's: beside the page, which
     makes room for it. Escape closes it. */
  useEffect(() => {
    if (!selected) return undefined;
    document.documentElement.classList.add('event-open');
    const close = (e: KeyboardEvent) => { if (e.key === 'Escape') setSelected(null); };
    window.addEventListener('keydown', close);
    return () => {
      document.documentElement.classList.remove('event-open');
      window.removeEventListener('keydown', close);
    };
  }, [selected]);

  /** A click on an event: a task's event opens the task itself, any other event its own panel. */
  const openEvent = (event: CalendarEvent) => {
    const taskId = linkedTaskId(event);
    const item = taskId ? snapshot.items[taskId] : undefined;
    if (item && !item.is_deleted) {
      setSelected(null);
      onOpen(item.id);
      return;
    }
    setSelected({ event });
  };

  /* ---------- Drawing ---------- */

  const rangeLabel = dayCount === 1
    ? new Intl.DateTimeFormat(intlLocale(locale), { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(days[0])
    : `${new Intl.DateTimeFormat(intlLocale(locale), { day: 'numeric', month: 'short' }).format(days[0])} – ${new Intl.DateTimeFormat(intlLocale(locale), { day: 'numeric', month: 'short', year: 'numeric' }).format(days[dayCount - 1])}`;

  if (access !== 'granted') {
    return (
      <div className="page cal-page">
        <div className="phead"><div className="phead-text"><h1 className="ptitle">{t('nav.calendar')}</h1></div></div>
        <div className="cal-gate">
          {access === 'checking' && <p>{t('cal.loading')}</p>}
          {access === 'unavailable' && <p>{t('cal.unavailable')}</p>}
          {access === 'notDetermined' && (
            <>
              <p>{t('cal.accessHint')}</p>
              <button className="btn primary" onClick={() => void checkAccess()}>{t('cal.access')}</button>
            </>
          )}
          {access === 'denied' && (
            <>
              <p>{t('cal.denied')}</p>
              <div className="cal-gate-actions">
                <button className="btn" onClick={() => window.open('x-apple.systempreferences:com.apple.preference.security?Privacy_Calendars')}>
                  {t('cal.openSettings')}
                </button>
                <button className="btn" onClick={() => void checkAccess()}>{t('cal.retry')}</button>
              </div>
            </>
          )}
        </div>
      </div>
    );
  }

  const sources = [...new Set(calendars.map((c) => c.source))];
  /* A day or longer (a holiday entered with times, a trip) reads as an all-day
     band: drawn in the grid it would fill whole columns. */
  const spansDays = (e: CalendarEvent) => e.allDay || new Date(e.end).getTime() - new Date(e.start).getTime() >= 24 * 60 * 60_000;
  const allDay = (day: Date) => events.filter((e) => spansDays(e) && onDay(e, day));

  return (
    <div className="cal-page cal-full" style={{ ['--days' as string]: dayCount }}>
      <div className="cal-head">
        <h1 className="ptitle">{t('nav.calendar')}</h1>
        <div className="cal-nav">
          <div className="cal-span" role="group" aria-label={t('cal.span')}>
            {(['week', 'two', 'day'] as const).map((value) => (
              <button key={value} aria-pressed={span === value} onClick={() => { setPrefs({ calendarSpan: value }); setAnchor(new Date()); }}>
                {t(`cal.span.${value}` as TranslationKey)}
              </button>
            ))}
          </div>
          <button className="iconbtn" aria-label={t('cal.previous')} onClick={() => step(-1)}>
            <Icon name="arrow-left" size="sm" />
          </button>
          <button className="btn" onClick={() => setAnchor(new Date())}>{t('cal.today')}</button>
          <button className="iconbtn" aria-label={t('cal.next')} onClick={() => step(1)}>
            <Icon name="arrow-right" size="sm" />
          </button>
          <span className="cal-range">{rangeLabel}</span>
          {loading && <span className="cal-loading" aria-live="polite">{t('cal.loading')}</span>}
          <span className="cal-zoom" title={t('cal.zoomHint')}>
            <button className="iconbtn" aria-label={t('cal.zoomOut')} onClick={() => zoomTo(hourPx / 1.25)} disabled={hourPx <= MIN_HOUR_PX}>−</button>
            <button className="iconbtn" aria-label={t('cal.zoomIn')} onClick={() => zoomTo(hourPx * 1.25)} disabled={hourPx >= MAX_HOUR_PX}>+</button>
          </span>
        </div>
        {!tasksOpen && (
          <button className="btn" onClick={() => setPrefs({ calendarTasksOpen: true })}>
            <Icon name="tasks" size="sm" /> {t('cal.showTasks')}
          </button>
        )}
        <button className={`btn${panel ? ' on' : ''}`} aria-expanded={panel} onClick={() => setPanel((v) => !v)}>
          <Icon name="calendar" size="sm" /> {t('cal.calendars')}
        </button>
      </div>

      {panel && (
        <div className="cal-panel">
          <p className="cal-panel-hint">{t('cal.calendarsHint')}</p>
          {!targetCalendar && <p className="cal-panel-warn">{t('cal.targetNone')}</p>}
          <label className="cal-check cal-sync">
            <input type="checkbox" checked={prefs.calendarSync} onChange={() => setPrefs({ calendarSync: !prefs.calendarSync })} />
            <span>
              <strong>{t('cal.sync')}</strong>
              <span className="cal-sync-hint">{t('cal.syncHint')}</span>
            </span>
          </label>
          {sources.map((source) => (
            <div key={source} className="cal-source">
              <h3>{source}</h3>
              {calendars.filter((c) => c.source === source).map((c) => (
                <div key={c.id} className="cal-row">
                  <label className="cal-check">
                    <input
                      type="checkbox"
                      checked={shownIds.includes(c.id)}
                      disabled={c.id === target}
                      title={c.id === target ? t('cal.targetAlwaysShown') : undefined}
                      onChange={() => {
                        const next = shownIds.includes(c.id) ? shownIds.filter((id) => id !== c.id) : [...shownIds, c.id];
                        setPrefs({ calendarIds: next });
                      }}
                    />
                    {c.title}
                  </label>
                  <span className="cal-color">
                    <button
                      className="cal-dot cal-dot-btn"
                      style={{ background: colorOf(c.id) }}
                      aria-label={t('cal.color', { name: c.title })}
                      title={t('cal.color', { name: c.title })}
                      aria-expanded={picking === c.id}
                      onClick={() => setPicking((id) => (id === c.id ? null : c.id))}
                    />
                    {picking === c.id && (
                      <span className="cal-palette" role="listbox" aria-label={t('cal.color', { name: c.title })}>
                        {CALENDAR_PALETTE.map((hex) => (
                          <button
                            key={hex}
                            role="option"
                            aria-selected={colorOf(c.id)?.toLowerCase() === hex}
                            className="cal-swatch"
                            style={{ background: hex }}
                            onClick={() => { setPrefs({ calendarColors: { ...colors, [c.id]: hex } }); setPicking(null); }}
                          />
                        ))}
                        <button
                          className="cal-swatch-reset"
                          onClick={() => {
                            const { [c.id]: _dropped, ...rest } = colors;
                            void _dropped;
                            setPrefs({ calendarColors: rest });
                            setPicking(null);
                          }}
                        >
                          {t('cal.colorReset')}
                        </button>
                      </span>
                    )}
                  </span>
                  {c.writable && !c.subscribed && (
                    <label className="cal-target">
                      <input type="radio" name="cal-target" checked={target === c.id} onChange={() => setPrefs({ calendarTarget: c.id })} />
                      {t('cal.target')}
                    </label>
                  )}
                </div>
              ))}
            </div>
          ))}
          <button className="btn" onClick={() => void createTasksCalendar()}>
            <Icon name="plus" size="sm" /> {t('cal.createCalendar', { name: t('cal.createdName') })}
          </button>
        </div>
      )}

      <div className={`cal-body${tasksOpen ? '' : ' folded'}`}>
        {tasksOpen && (
          <aside className="cal-tasks" aria-label={t('cal.tasks')}>
            <div className="detail-top cal-tasks-head">
              <span className="crumb">{t('cal.tasks')}</span>
              <button className="iconbtn" aria-label={t('cal.hideTasks')} title={t('cal.hideTasks')} onClick={() => setPrefs({ calendarTasksOpen: false })}>
                <Icon name="sidebar" size="sm" />
              </button>
            </div>
            <div className="cal-tasks-tools">
              <input
                className="cal-tasks-search"
                type="search"
                value={query}
                placeholder={t('cal.search')}
                onChange={(e) => setQuery(e.target.value)}
              />
              <div className="cal-tasks-order">
                <label>
                  <span>{t('cal.groupBy')}</span>
                  <select value={groupMode} onChange={(e) => setPrefs({ calendarGroupBy: e.target.value as TaskGroupMode })}>
                    {TASK_GROUPS.map((mode) => <option key={mode} value={mode}>{t(`cal.group.${mode}` as TranslationKey)}</option>)}
                  </select>
                </label>
                <label>
                  <span>{t('cal.sortBy')}</span>
                  <select value={sortBy} onChange={(e) => setPrefs({ calendarSortBy: e.target.value as TaskSortMode })}>
                    {TASK_SORTS.map((mode) => <option key={mode} value={mode}>{t(`cal.sort.${mode}` as TranslationKey)}</option>)}
                  </select>
                </label>
                <button
                  className="iconbtn cal-sortdir"
                  aria-label={sortDesc ? t('cal.sortDesc') : t('cal.sortAsc')}
                  title={sortDesc ? t('cal.sortDesc') : t('cal.sortAsc')}
                  onClick={() => setPrefs({ calendarSortDesc: !sortDesc })}
                >
                  {sortDesc ? '↓' : '↑'}
                </button>
              </div>
              <p className="cal-tasks-hint">{t('cal.unplannedHint')}</p>
            </div>
            <div className="cal-tasks-list">
              {groups.length === 0 && <p className="cal-empty">{t('cal.noTasks')}</p>}
              {groups.map((group) => (
                <section key={group.key} className="cal-tasks-section">
                  {groupMode !== 'none' && <h3>{groupTitle(group.key)} <span>{group.items.length}</span></h3>}
                  <ul>
                    {group.items.map((item) => {
                      const minutes = minutesOf(item);
                      const planned = linked.has(item.id);
                      const due = dueDate(item);
                      return (
                        <li
                          key={item.id}
                          className={`cal-task p${toDisplayPriority(item.priority)}${planned ? ' planned' : ''}`}
                          draggable
                          title={planned ? t('cal.inCalendar') : undefined}
                          onDragStart={(e) => startTaskDrag(e, item)}
                          onDragEnd={endDrag}
                          onDoubleClick={() => onOpen(item.id)}
                        >
                          <span className="cal-task-main">
                            <span className="cal-task-title">{plainTitle(item.content)}</span>
                            {groupMode !== 'due' && due && (
                              <span className="cal-task-due">{hasTime(item.due) ? timeLabel(due) : new Intl.DateTimeFormat(intlLocale(locale), { weekday: 'short', day: 'numeric', month: 'short' }).format(due)}</span>
                            )}
                          </span>
                          {planned && <Icon name="calendar" size="sm" />}
                          <span className="cal-task-est" title={minutes === null ? t('cal.defaultDuration') : undefined}>
                            {formatDuration(minutes ?? DEFAULT_TASK_MINUTES, locale)}{minutes === null ? '*' : ''}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              ))}
            </div>
          </aside>
        )}

        <div className="cal-grid-wrap">
          <div className="cal-days">
            <div className="cal-gutter" />
            {days.map((day) => (
              <div key={day.toISOString()} className={`cal-dayhead${isSameDay(day, now) ? ' today' : ''}`}>
                <span className="cal-dow">{new Intl.DateTimeFormat(intlLocale(locale), { weekday: 'short' }).format(day)}</span>
                <span className="cal-dom">{format(day, 'd')}</span>
              </div>
            ))}
          </div>
          <div className="cal-allday">
            <div className="cal-gutter">{t('cal.allDay')}</div>
            {days.map((day) => (
              <div key={day.toISOString()} className="cal-allday-cell">
                {allDay(day).map((e) => (
                  <button
                    key={`${e.id}-${day.toISOString()}`}
                    className="cal-chip"
                    style={{ ['--ev' as string]: colorOf(e.calendarId) ?? 'var(--accent)' }}
                    onClick={() => openEvent(e)}
                  >
                    {e.title}
                  </button>
                ))}
              </div>
            ))}
          </div>
          <div className="cal-scroll" ref={scroller}>
            <div className="cal-grid" style={{ height: px(DAY_MINUTES), ['--hour' as string]: `${hourPx}px` }}>
              <div className="cal-gutter cal-hours">
                {Array.from({ length: 24 }, (_, h) => (
                  <span key={h} style={{ top: px(h * 60) }}>{h === 0 ? '' : formatTime(new Date(2026, 0, 1, h), locale, hour12)}</span>
                ))}
              </div>
              {days.map((day, dayIndex) => {
                const timed = events.filter((e) => !spansDays(e) && onDay(e, day));
                const placed = layoutDay<GridEntry>([
                  ...timed.map((e) => ({ item: { kind: 'event', event: e } as GridEntry, start: new Date(e.start), end: new Date(e.end) })),
                  ...timedTasks.filter(({ start }) => isSameDay(start, day)).map(({ item, start }) => ({
                    item: { kind: 'task', task: item } as GridEntry,
                    start,
                    end: new Date(start.getTime() + (minutesOf(item) ?? DEFAULT_TASK_MINUTES) * 60_000),
                  })),
                ], day);
                return (
                  <div
                    key={day.toISOString()}
                    className={`cal-col${isSameDay(day, now) ? ' today' : ''}`}
                    onDragOver={(e) => onDragOver(e, dayIndex)}
                    onDragLeave={(e) => { if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node)) setHover(null); }}
                    onDrop={(e) => onDrop(e, dayIndex)}
                  >
                    {placed.map(({ item: entry, top, bottom, column, columns }) => {
                      const style = {
                        top: px(top),
                        height: Math.max(px(bottom - top) - 2, 14),
                        left: `calc(${(column / columns) * 100}% + 2px)`,
                        width: `calc(${100 / columns}% - 4px)`,
                      };
                      if (entry.kind === 'task') {
                        const task = entry.task;
                        return (
                          <div
                            key={`task-${task.id}`}
                            className="cal-event cal-event-task"
                            style={style}
                            draggable
                            title={t('cal.timedTask')}
                            onDragStart={(e) => {
                              const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                              startTaskDrag(e, task, ((e.clientY - rect.top) / hourPx) * 60);
                            }}
                            onDragEnd={endDrag}
                            onClick={() => onOpen(task.id)}
                          >
                            <span className="cal-event-title">{plainTitle(task.content)}</span>
                          </div>
                        );
                      }
                      const e = entry.event;
                      const fromTask = linkedTaskId(e) !== null && byId.get(e.calendarId)?.writable;
                      const start = new Date(e.start);
                      const live = resize && resize.eventId === e.id ? resize : null;
                      const sized = live
                        ? { ...style, top: px(live.top), height: Math.max(px(live.bottom - live.top) - 2, 14) }
                        : style;
                      return (
                        <div
                          key={e.id}
                          className={`cal-event${fromTask ? ' from-task' : ''}${live ? ' resizing' : ''}`}
                          style={{ ...sized, ['--ev' as string]: colorOf(e.calendarId) ?? 'var(--accent)' }}
                          draggable={Boolean(fromTask)}
                          onDragStart={fromTask ? (d) => startEventDrag(d, e) : undefined}
                          onDragEnd={endDrag}
                          onClick={() => { if (!justResized.current) openEvent(e); }}
                          // Right-click on a task's event shows the event itself (to take it out of the calendar).
                          onContextMenu={(ev) => { ev.preventDefault(); setSelected({ event: e }); }}
                        >
                          <span className="cal-event-title">{e.title}</span>
                          {live
                            ? (
                              <span className="cal-event-time">
                                {formatTime(new Date(startOfDay(day).getTime() + live.top * 60_000), locale, hour12)}–{formatTime(new Date(startOfDay(day).getTime() + live.bottom * 60_000), locale, hour12)} · {formatDuration(live.bottom - live.top, locale)}
                              </span>
                            )
                            : px(bottom - top) >= 36 && <span className="cal-event-time">{formatTime(start, locale, hour12)}</span>}
                          {fromTask && (
                            <>
                              <span
                                className="cal-resize top"
                                draggable={false}
                                onMouseDown={(ev) => ev.preventDefault()}
                                onPointerDown={(ev) => beginResize(ev, e, 'top', day)}
                                onClick={(ev) => ev.stopPropagation()}
                              />
                              <span
                                className="cal-resize bottom"
                                draggable={false}
                                onMouseDown={(ev) => ev.preventDefault()}
                                onPointerDown={(ev) => beginResize(ev, e, 'bottom', day)}
                                onClick={(ev) => ev.stopPropagation()}
                              />
                            </>
                          )}
                        </div>
                      );
                    })}
                    {hover && hover.day === dayIndex && (
                      <div className="cal-ghost" style={{ top: px(hover.minute), height: px(hover.minutes) }}>
                        {formatTime(new Date(day.getTime() + hover.minute * 60_000), locale, hour12)} · {formatDuration(hover.minutes, locale)}
                      </div>
                    )}
                    {isSameDay(day, now) && (
                      <div className="cal-now" style={{ top: px((now.getTime() - startOfDay(now).getTime()) / 60_000) }} />
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {selected && (() => {
        const e = selected.event;
        const calendar = byId.get(e.calendarId);
        const taskId = linkedTaskId(e);
        const start = new Date(e.start);
        const end = new Date(e.end);
        const dayFormat = new Intl.DateTimeFormat(intlLocale(locale), { weekday: 'long', day: 'numeric', month: 'long' });
        const when = e.allDay
          ? `${dayFormat.format(start)} · ${t('cal.allDay')}`
          : `${dayFormat.format(start)} · ${formatTime(start, locale, hour12)}–${formatTime(end, locale, hour12)}`;
        const link = /^https?:\/\//.test(e.url) ? e.url : '';
        return (
          <aside className="cal-eventsheet" aria-label={e.title}>
            <div className="detail-top">
              <span className="crumb"><span className="cal-dot" style={{ background: colorOf(calendar?.id) }} /> {calendar?.title ?? t('nav.calendar')}</span>
              <button className="iconbtn" aria-label={t('common.close')} title={t('common.close')} onClick={() => setSelected(null)}>
                <Icon name="close" size="sm" />
              </button>
            </div>
            <div className="cal-eventsheet-main">
              <h2 className="cal-eventsheet-title">{e.title || '—'}</h2>
              {e.notes && <p className="cal-eventsheet-notes">{e.notes}</p>}
            </div>
            <div className="detail-side cal-eventsheet-side">
              <div className="prop">
                <span className="proplabel">{t('cal.when')}</span>
                <div className="cal-propvalue">{when}</div>
              </div>
              <div className="prop">
                <span className="proplabel">{t('cal.calendar')}</span>
                <div className="cal-propvalue"><span className="cal-dot" style={{ background: colorOf(calendar?.id) }} /> {calendar ? `${calendar.title} · ${calendar.source}` : '—'}</div>
              </div>
              {e.location && (
                <div className="prop">
                  <span className="proplabel">{t('cal.location')}</span>
                  <div className="cal-propvalue">{e.location}</div>
                </div>
              )}
              {link && (
                <div className="prop">
                  <span className="proplabel">{t('cal.link')}</span>
                  <a className="cal-propvalue cal-proplink" href={link} target="_blank" rel="noreferrer">{link}</a>
                </div>
              )}
              {taskId && (
                <div className="cal-eventsheet-actions">
                  {snapshot.items[taskId] && (
                    <button className="btn" onClick={() => { setSelected(null); onOpen(taskId); }}>{t('cal.openTask')}</button>
                  )}
                  {calendar?.writable && (
                    <button className="btn" onClick={() => void remove(e)}>{t('cal.remove')}</button>
                  )}
                </div>
              )}
            </div>
          </aside>
        );
      })()}
    </div>
  );
}
