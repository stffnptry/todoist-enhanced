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
import { useCompletedAround } from '@/hooks/useCompletedAround';
import { uncompleteItem } from '@/api/commands';
import { loadOccurrences, pruneOccurrences, saveOccurrences, type DoneOccurrence } from '@/lib/doneOccurrences';
import { intlLocale, type TranslationKey } from '@/i18n';
import { toDisplayPriority } from '@/domain/types';
import {
  DEFAULT_TASK_MINUTES, SNAP_MINUTES, TASK_GROUPS, TASK_SORTS, type TaskGroupMode, type TaskSortMode, dueBucket, groupTasks, layoutDay, linkedTaskId, onDay, snapMinutes,
  taskBlocks, type CalendarEvent, type CalendarInfo, type TaskBlock,
} from '@/domain/calendar';
import type { Item } from '@/domain/types';
import { ContextMenu, type ContextMenuItem } from '@/components/ContextMenu';
import { useConfirm } from '@/components/overlays/Confirm';
import { leaveToText, pointAnchor } from '@/lib/contextMenu';
import { copyText, isTemporaryId, todoistTaskUrl } from '@/api/links';
import { toApiDate } from '@/domain/dates';

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

/** What is being dragged: a task from the list, or its block on the grid. */
type Drag = { item: Item; minutes: number; offset: number };

type Answer = { ok: boolean; error?: string; [key: string]: unknown };
type GridEntry = { kind: 'event'; event: CalendarEvent } | { kind: 'task'; block: TaskBlock<Item> };

const call = (command: string, input?: Record<string, unknown>): Promise<Answer> =>
  window.enhancedDesktop?.calendar?.(command, input) ?? Promise.resolve({ ok: false, error: 'unavailable' });

/**
 * The week as the Mac's calendars see it, with the tasks drawn into it.
 *
 * Calendars are only read. Tasks are drawn straight from Todoist: every task
 * with a time is a block as long as its estimate (30 minutes without one).
 * Dropping a task on the grid gives it that time, dragging a block's edge
 * changes its estimate, and its tick completes it, all in Todoist. Done tasks
 * stay where they were, faded. Nothing is written into a calendar any more.
 */
export function CalendarView({ onOpen, onAddTask }: {
  onOpen: (id: string) => void;
  /** Neue Aufgabe zu einer Zeit im Raster (Doppelklick, Rechtsklick, Aufziehen). */
  onAddTask?: (placement: { date: string; minutes: number }) => void;
}) {
  const { t, locale } = useT();
  const { snapshot, items, childrenOf } = useData();
  const hour12 = useStore((s) => s.prefs.hour12);
  const calendarIds = useStore((s) => s.prefs.calendarIds);
  const setPrefs = useStore((s) => s.setPrefs);
  const updateTask = useStore((s) => s.updateTask);
  const setEstimates = useStore((s) => s.setEstimates);
  const toggleTask = useStore((s) => s.toggleTask);
  const applyCommands = useStore((s) => s.apply);
  const refresh = useStore((s) => s.refresh);
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
  const shownIds = useMemo(
    () => (calendarIds ?? calendars.map((c) => c.id)).filter((id) => byId.has(id)),
    [calendarIds, calendars, byId],
  );
  const colors = useStore((s) => s.prefs.calendarColors);
  /** A calendar's colour: the one chosen here, else its own. */
  const colorOf = (id: string | undefined): string | undefined => (id ? colors[id] ?? byId.get(id)?.color : undefined);
  const [picking, setPicking] = useState<string | null>(null);

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
    /* Termine mit Todoist-Link hat der frühere Abgleich angelegt: Die Aufgabe
       steht selbst im Raster, ihr alter Termin wäre sie ein zweites Mal. */
    if (answer.ok) setEvents(((answer.events as CalendarEvent[]) ?? []).filter((e) => !linkedTaskId(e)));
  }, [access, calendars.length, week.start, dayCount, shownIds]);

  useEffect(() => {
    void loadEvents();
    const timer = setInterval(() => { void loadEvents(); }, 2 * 60_000);
    const onChanged = () => { void loadEvents(); };
    window.addEventListener('enhanced:calendar-changed', onChanged);
    const onFocus = () => { void loadEvents(); };
    window.addEventListener('focus', onFocus);
    return () => {
      clearInterval(timer);
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('enhanced:calendar-changed', onChanged);
    };
  }, [loadEvents]);

  // Eigener Takt für den Jetzt-Strich, unabhängig vom Termin-Abgleich: Alle
  // 2 Minuten waren bei 64 px/h nur ~2 px, der Strich wirkte ohne Fokus starr.
  // Beim Wiederaufdecken sofort nachziehen (gedrosselte Timer im Hintergrund).
  useEffect(() => {
    const tick = () => setNow(new Date());
    const timer = setInterval(tick, 30_000);
    const onVisible = () => { if (document.visibilityState === 'visible') tick(); };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', tick);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', tick);
    };
  }, []);

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
  /* Every task with a time on the days shown, open or done. Done ones come
     from the snapshot (ticked since the last full sync) and from Todoist's
     history (everything else), so they stay where they were planned. */
  const weekEnd = useMemo(() => addDays(week.start, dayCount), [week.start, dayCount]);
  const completed = useCompletedAround(week.start, weekEnd);
  const [occurrences, setOccurrences] = useState<DoneOccurrence[]>(loadOccurrences);
  const blocks = useMemo(() => {
    const openIds = new Set(roots.map((i) => i.id));
    const doneHere = Object.values(snapshot.items)
      .filter((i) => i.checked && !i.is_deleted && !(i.parent_id && openIds.has(i.parent_id)));
    const doneEarlier = completed.items.map((c) => ({ ...c, id: c.task_id ?? c.id, checked: true }) as unknown as Item);
    const drawn = taskBlocks(
      roots, [...doneHere, ...doneEarlier],
      (i) => (hasTime(i.due) ? dueDate(i) : null),
      week.start, weekEnd,
    );
    const finished: Array<TaskBlock<Item>> = occurrences
      .map((o) => ({ task: snapshot.items[o.taskId], start: new Date(o.start), done: true, occurrence: true }))
      .filter((b) => b.task && !b.task.is_deleted && b.start >= week.start && b.start < weekEnd
        && !drawn.some((d) => d.task.id === b.task.id && d.start.getTime() === b.start.getTime()));
    return [...drawn, ...finished];
  }, [roots, snapshot.items, completed.items, occurrences, week.start, weekEnd]);

  /* ---------- Writing ---------- */

  const timeLabel = (date: Date) =>
    `${new Intl.DateTimeFormat(intlLocale(locale), { weekday: 'short', day: 'numeric', month: 'short' }).format(date)} ${formatTime(date, locale, hour12)}`;

  /* ---------- Rechtsklick ---------- */

  const removeTask = useStore((s) => s.removeTask);
  const demo = useStore((s) => s.demo);
  const confirm = useConfirm();
  /** Das offene Rechtsklick-Menü: wo, und was darin steht. */
  const [context, setContext] = useState<{ anchor: HTMLElement; label: string; items: ContextMenuItem[] } | null>(null);
  const closeContext = useCallback(() => setContext(null), []);

  /** Was man mit einer Aufgabe tun kann – im Raster (mit Uhrzeit) wie in der Liste daneben. */
  const taskItems = (task: Item, block?: { start: Date; done: boolean; occurrence: boolean }): ContextMenuItem[] => {
    const known = Boolean(snapshot.items[task.id]);
    return [
      { key: 'edit', label: t('task.edit'), icon: 'edit', onPick: () => onOpen(task.id) },
      ...(block && !block.occurrence ? [{
        key: 'done', label: block.done ? t('cal.reopen') : t('cal.complete'), icon: 'check' as const,
        onPick: () => toggleDone(task, block.start),
      }] : []),
      /* Nicht bei wiederkehrenden: Ihre Uhrzeit steht in der Regel („every mon at 9“). */
      ...(block && !block.done && known && !task.due?.is_recurring ? [{
        key: 'unschedule', label: t('cal.unschedule'), icon: 'calendar' as const,
        /* Der Tag bleibt, nur die Uhrzeit geht: Die Aufgabe wandert zurück in die Liste. */
        onPick: () => void updateTask(task.id, { due: dueForDate(task.due, toApiDate(block.start), 'en', { dropTime: true }) }),
      }] : []),
      {
        key: 'todoist', label: t('task.openInTodoist'), icon: 'external', separated: true,
        onPick: () => { window.open(todoistTaskUrl(task.id), '_blank', 'noopener'); },
      },
      ...(!demo && !isTemporaryId(task.id) ? [{
        key: 'link', label: t('task.copyLink'), icon: 'link' as const,
        onPick: () => void copyText(todoistTaskUrl(task.id)).then((ok) => toast(t(ok ? 'task.linkCopied' : 'task.linkNotCopied'))),
      }] : []),
      ...(known ? [{
        key: 'delete', label: t('task.delete'), icon: 'close' as const, danger: true, separated: true,
        onPick: () => void confirm({
          title: t('task.deleteTitle'),
          body: t('task.deleteConfirm', { name: task.content }),
          confirmLabel: t('task.delete'),
          destructive: true,
        }).then((ok) => { if (ok) void removeTask(task.id); }),
      }] : []),
    ];
  };

  const eventItems = (event: CalendarEvent): ContextMenuItem[] => {
    const link = /^https?:\/\//.test(event.url) ? event.url : '';
    return [
      { key: 'show', label: t('cal.showEvent'), icon: 'calendar', onPick: () => openEvent(event) },
      ...(link ? [{ key: 'link', label: t('cal.openLink'), icon: 'external' as const, onPick: () => { window.open(link, '_blank', 'noopener'); } }] : []),
      ...(event.title ? [{
        key: 'copy', label: t('cal.copyTitle'), icon: 'copy' as const,
        onPick: () => void copyText(event.title).then((ok) => toast(t(ok ? 'cal.titleCopied' : 'comment.notCopied'))),
      }] : []),
    ];
  };

  /** Öffnet ein Rechtsklick-Menü am Zeiger – außer über Text, der markiert ist. */
  const openContext = (event: React.MouseEvent, label: string, items: ContextMenuItem[]) => {
    if (leaveToText(event.nativeEvent)) return;
    event.preventDefault();
    event.stopPropagation();
    setContext({ anchor: pointAnchor(event), label, items });
  };

  /** A task dropped on the grid: it gets that time in Todoist, and its block follows. */
  const schedule = (item: Item, start: Date) => {
    void updateTask(item.id, { due: dueForDate(item.due, toApiDateTime(start)) });
    toast(t('cal.scheduled', { name: plainTitle(item.content), time: timeLabel(start) }));
  };

  /** The tick on a block: done in Todoist, or open again. */
  const toggleDone = (task: Item, start: Date) => {
    if (snapshot.items[task.id]) {
      // Eine wiederkehrende Aufgabe springt weiter: Das erledigte Vorkommen bleibt hier stehen.
      if (!task.checked && task.due?.is_recurring) {
        const next = pruneOccurrences([...occurrences, { taskId: task.id, start: start.toISOString() }], Date.now());
        setOccurrences(next);
        saveOccurrences(next);
      }
      void toggleTask(task.id);
      return;
    }
    // Nur noch im Verlauf (seit dem letzten vollen Abgleich erledigt): direkt
    // wieder öffnen; der nächste Abgleich bringt die Aufgabe zurück.
    completed.forget(task.id);
    void applyCommands([uncompleteItem(task.id)], (snap) => snap).then(() => refresh());
  };

  /* ---------- Neue Aufgabe im Raster, wie in Apple Kalender ----------
     Doppelklick auf eine freie Stelle, Rechtsklick → „Neue Aufgabe um …“ oder
     einen Zeitraum aufziehen. Es öffnet sich die normale Eingabe mit Tag,
     Uhrzeit und – beim Aufziehen – der Länge als Schätzung. */

  const [draft, setDraft] = useState<{ day: number; top: number; bottom: number } | null>(null);

  const addAt = (day: Date, startMinute: number, minutes: number) => {
    if (!onAddTask) return;
    onAddTask({ date: toApiDateTime(new Date(startOfDay(day).getTime() + startMinute * 60_000)), minutes });
  };

  /** Die Minute unter dem Zeiger in einer Tagesspalte, auf das Raster abgerundet. */
  const columnMinute = (column: HTMLElement, clientY: number) => {
    const raw = ((clientY - column.getBoundingClientRect().top) / zoomRef.current) * 60;
    return Math.max(0, Math.min(DAY_MINUTES - SNAP_MINUTES, Math.floor(raw / SNAP_MINUTES) * SNAP_MINUTES));
  };

  /** Nur freie Fläche zählt: auf Terminen und Aufgaben gelten deren eigene Klicks. */
  const onFreeSpace = (target: EventTarget) => !(target as HTMLElement).closest('.cal-event, .cal-now');

  const beginDraft = (pointer: ReactPointerEvent, dayIndex: number) => {
    if (!onAddTask || pointer.button !== 0 || !onFreeSpace(pointer.target)) return;
    const column = pointer.currentTarget as HTMLElement;
    const from = columnMinute(column, pointer.clientY);
    const startY = pointer.clientY;
    let current = { top: from, bottom: from + SNAP_MINUTES };
    let moved = false;

    const onMove = (move: PointerEvent) => {
      if (!moved && Math.abs(move.clientY - startY) < 4) return;
      moved = true;
      const minute = columnMinute(column, move.clientY);
      current = minute >= from
        ? { top: from, bottom: minute + SNAP_MINUTES }
        : { top: minute, bottom: from + SNAP_MINUTES };
      setDraft({ day: dayIndex, ...current });
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      setDraft(null);
      if (moved) addAt(days[dayIndex], current.top, current.bottom - current.top);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  const onGridDoubleClick = (event: React.MouseEvent, dayIndex: number) => {
    if (!onAddTask || !onFreeSpace(event.target)) return;
    addAt(days[dayIndex], columnMinute(event.currentTarget as HTMLElement, event.clientY), DEFAULT_TASK_MINUTES);
  };

  const onGridContext = (event: React.MouseEvent, dayIndex: number) => {
    if (!onAddTask || !onFreeSpace(event.target)) return;
    const minute = columnMinute(event.currentTarget as HTMLElement, event.clientY);
    const at = new Date(startOfDay(days[dayIndex]).getTime() + minute * 60_000);
    openContext(event, t('cal.newTask'), [{
      key: 'new', label: t('cal.newTaskAt', { time: timeLabel(at) }), icon: 'plus',
      onPick: () => addAt(days[dayIndex], minute, DEFAULT_TASK_MINUTES),
    }]);
  };

  /* ---------- Resizing a task's block: its length is the task's estimate ---------- */

  const [resize, setResize] = useState<{ taskId: string; top: number; bottom: number } | null>(null);
  const resizing = useRef(false);
  const justResized = useRef(false);

  const beginResize = (pointer: ReactPointerEvent, task: Item, start: Date, minutes: number, edge: 'top' | 'bottom', day: Date) => {
    pointer.preventDefault();
    pointer.stopPropagation();
    const column = (pointer.currentTarget as HTMLElement).closest('.cal-col') as HTMLElement | null;
    if (!column) return;
    const midnight = startOfDay(day).getTime();
    const startMin = (start.getTime() - midnight) / 60_000;
    const endMin = Math.min(DAY_MINUTES, startMin + minutes);
    resizing.current = true;
    let current = { top: startMin, bottom: endMin };
    setResize({ taskId: task.id, ...current });

    const onMove = (move: PointerEvent) => {
      const rect = column.getBoundingClientRect();
      const raw = ((move.clientY - rect.top) / zoomRef.current) * 60;
      const minute = Math.max(0, Math.min(DAY_MINUTES, Math.round(raw / SNAP_MINUTES) * SNAP_MINUTES));
      current = edge === 'bottom'
        ? { top: current.top, bottom: Math.max(current.top + SNAP_MINUTES, minute) }
        : { top: Math.min(current.bottom - SNAP_MINUTES, minute), bottom: current.bottom };
      setResize({ taskId: task.id, ...current });
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      resizing.current = false;
      justResized.current = true;
      setTimeout(() => { justResized.current = false; }, 0);
      setResize(null);
      if (current.top === startMin && current.bottom === endMin) return;
      applyResize(task, start, new Date(midnight + current.top * 60_000), new Date(midnight + current.bottom * 60_000));
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  /** A new length is a new estimate; the top edge moved is a new time as well. */
  const applyResize = (task: Item, was: Date, start: Date, end: Date) => {
    const minutes = Math.round((end.getTime() - start.getTime()) / 60_000);
    void setEstimates([{ id: task.id, minutes }]);
    if (start.getTime() !== was.getTime()) void updateTask(task.id, { due: dueForDate(task.due, toApiDateTime(start)) });
    toast(t('cal.resized', { name: plainTitle(task.content), duration: formatDuration(minutes, locale) }));
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
    if (resizing.current) { event.preventDefault(); return; }
    drag.current = { item, minutes, offset: grabbedAt };
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', plainTitle(item.content));
    dragPicture(event, plainTitle(item.content), minutes);
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
    schedule(current.item, start);
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

  const openEvent = (event: CalendarEvent) => setSelected({ event });

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
          {sources.map((source) => (
            <div key={source} className="cal-source">
              <h3>{source}</h3>
              {calendars.filter((c) => c.source === source).map((c) => (
                <div key={c.id} className="cal-row">
                  <label className="cal-check">
                    <input
                      type="checkbox"
                      checked={shownIds.includes(c.id)}
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
                </div>
              ))}
            </div>
          ))}
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
                      const planned = hasTime(item.due);
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
                          onContextMenu={(ev) => openContext(ev, t('task.moreActions'), taskItems(item))}
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
                    onContextMenu={(ev) => openContext(ev, t('cal.eventActions'), eventItems(e))}
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
                  ...blocks.filter(({ start }) => isSameDay(start, day)).map((block) => ({
                    item: { kind: 'task', block } as GridEntry,
                    start: block.start,
                    end: new Date(block.start.getTime() + (minutesOf(block.task) ?? DEFAULT_TASK_MINUTES) * 60_000),
                  })),
                ], day);
                return (
                  <div
                    key={day.toISOString()}
                    className={`cal-col${isSameDay(day, now) ? ' today' : ''}`}
                    onDragOver={(e) => onDragOver(e, dayIndex)}
                    onDragLeave={(e) => { if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node)) setHover(null); }}
                    onDrop={(e) => onDrop(e, dayIndex)}
                    onPointerDown={(e) => beginDraft(e, dayIndex)}
                    onDoubleClick={(e) => onGridDoubleClick(e, dayIndex)}
                    onContextMenu={(e) => onGridContext(e, dayIndex)}
                  >
                    {draft && draft.day === dayIndex && (
                      <div
                        className="cal-event cal-draft"
                        style={{ top: px(draft.top), height: Math.max(px(draft.bottom - draft.top) - 2, 14), left: 2, width: 'calc(100% - 4px)' }}
                      >
                        <strong>{t('cal.newTask')}</strong>
                        <span>
                          {formatTime(new Date(startOfDay(day).getTime() + draft.top * 60_000), locale, hour12)}–{formatTime(new Date(startOfDay(day).getTime() + draft.bottom * 60_000), locale, hour12)}
                          {' · '}{formatDuration(draft.bottom - draft.top, locale)}
                        </span>
                      </div>
                    )}
                    {placed.map(({ item: entry, top, bottom, column, columns }) => {
                      const style = {
                        top: px(top),
                        height: Math.max(px(bottom - top) - 2, 14),
                        left: `calc(${(column / columns) * 100}% + 2px)`,
                        width: `calc(${100 / columns}% - 4px)`,
                      };
                      if (entry.kind === 'task') {
                        const { task, start, done, occurrence } = entry.block;
                        const minutes = minutesOf(task) ?? DEFAULT_TASK_MINUTES;
                        const live = resize && resize.taskId === task.id ? resize : null;
                        const sized = live
                          ? { ...style, top: px(live.top), height: Math.max(px(live.bottom - live.top) - 2, 14) }
                          : style;
                        return (
                          <div
                            key={`task-${task.id}-${occurrence ? start.getTime() : ''}`}
                            className={`cal-event cal-taskblock p${toDisplayPriority(task.priority)}${done ? ' done' : ''}${live ? ' resizing' : ''}`}
                            style={sized}
                            draggable={!done}
                            title={done ? t('cal.doneBlock') : t('cal.taskBlock')}
                            onDragStart={done ? undefined : (e) => {
                              const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                              startTaskDrag(e, task, ((e.clientY - rect.top) / hourPx) * 60);
                            }}
                            onDragEnd={endDrag}
                            onClick={() => { if (!justResized.current) onOpen(task.id); }}
                            onContextMenu={(ev) => openContext(ev, t('task.moreActions'), taskItems(task, { start, done, occurrence: Boolean(occurrence) }))}
                          >
                            <span className="cal-taskblock-head">
                              <button
                                type="button"
                                className={`cal-tick${done ? ' on' : ''}`}
                                role="checkbox"
                                aria-checked={done}
                                aria-label={done ? t('cal.reopen') : t('cal.complete')}
                                title={done ? t('cal.reopen') : t('cal.complete')}
                                draggable={false}
                                onMouseDown={(ev) => ev.stopPropagation()}
                                disabled={occurrence}
                                onClick={(ev) => { ev.stopPropagation(); toggleDone(task, start); }}
                              >
                                {done && <Icon name="check" size="sm" />}
                              </button>
                              <span className="cal-event-title">{plainTitle(task.content)}</span>
                            </span>
                            {live
                              ? (
                                <span className="cal-event-time">
                                  {formatTime(new Date(startOfDay(day).getTime() + live.top * 60_000), locale, hour12)}–{formatTime(new Date(startOfDay(day).getTime() + live.bottom * 60_000), locale, hour12)} · {formatDuration(live.bottom - live.top, locale)}
                                </span>
                              )
                              : px(bottom - top) >= 36 && <span className="cal-event-time">{formatTime(start, locale, hour12)} · {formatDuration(minutes, locale)}</span>}
                            {!done && (
                              <>
                                <span
                                  className="cal-resize top"
                                  draggable={false}
                                  onMouseDown={(ev) => ev.preventDefault()}
                                  onPointerDown={(ev) => beginResize(ev, task, start, minutes, 'top', day)}
                                  onClick={(ev) => ev.stopPropagation()}
                                />
                                <span
                                  className="cal-resize bottom"
                                  draggable={false}
                                  onMouseDown={(ev) => ev.preventDefault()}
                                  onPointerDown={(ev) => beginResize(ev, task, start, minutes, 'bottom', day)}
                                  onClick={(ev) => ev.stopPropagation()}
                                />
                              </>
                            )}
                          </div>
                        );
                      }
                      const e = entry.event;
                      const start = new Date(e.start);
                      return (
                        <div
                          key={e.id}
                          className="cal-event"
                          style={{ ...style, ['--ev' as string]: colorOf(e.calendarId) ?? 'var(--accent)' }}
                          onClick={() => openEvent(e)}
                          onContextMenu={(ev) => openContext(ev, t('cal.eventActions'), eventItems(e))}
                        >
                          <span className="cal-event-title">{e.title}</span>
                          {px(bottom - top) >= 36 && <span className="cal-event-time">{formatTime(start, locale, hour12)}</span>}
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

      {context && <ContextMenu anchor={context.anchor} label={context.label} items={context.items} onClose={closeContext} />}

      {selected && (() => {
        const e = selected.event;
        const calendar = byId.get(e.calendarId);
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
            </div>
          </aside>
        );
      })()}
    </div>
  );
}
