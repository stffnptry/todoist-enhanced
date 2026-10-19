/**
 * Geplant gegen abgehakt, für den Report.
 *
 * Für jede erledigte Aufgabe: Wofür war sie geplant (Tag, ggf. Uhrzeit), wann
 * wurde sie wirklich abgehakt, und – wenn sie unterwegs verschoben wurde –
 * wofür war sie ursprünglich geplant. Den Plan nimmt die Rechnung aus dem
 * Abhak-Protokoll der App, sonst aus dem Datum, das Todoist zur erledigten
 * Aufgabe liefert. Daraus entstehen die Muster: früher, am Tag, später; wie
 * weit Uhrzeiten danebenliegen; welche Wochentage und Bereiche halten.
 */
import { differenceInCalendarDays, differenceInMinutes } from 'date-fns';
import type { CompletionEntry } from '@/lib/completionLog';
import type { RescheduleEntry } from '@/lib/rescheduleLog';
import type { CompletedItem } from './types';

export interface PlanRow {
  taskId: string;
  title: string;
  area: string;
  /** Der Plan beim Abhaken: `yyyy-MM-dd` oder mit Uhrzeit. */
  planned: string;
  hasTime: boolean;
  doneAt: Date;
  /** Abgehakt minus geplant, in Kalendertagen (negativ = früher). */
  dayDiff: number;
  /** Nur mit Uhrzeit: Abweichung in Minuten (negativ = früher). */
  minuteDiff: number | null;
  /** Der erste Plan, wenn die Aufgabe vorher verschoben wurde. */
  original: string | null;
  /** Abgehakt minus ursprünglicher Plan, in Tagen. */
  originalDiff: number | null;
  moves: number;
}

export interface Timing {
  rows: PlanRow[];
  /** Erledigte ohne Datum (spontan). */
  unplanned: number;
  early: number;
  onDay: number;
  late: number;
  avgLateDays: number;
  maxLateDays: number;
  /** Aufgaben mit Uhrzeit, am geplanten Tag erledigt. */
  timed: {
    count: number;
    /** Median der Abweichung in Minuten, mit Vorzeichen. */
    medianMinutes: number;
    /** Innerhalb ±30 Minuten. */
    close: number;
    later: number;
    earlier: number;
  };
  /** Pro Wochentag des Plans (0 = Sonntag): wie viele geplant, wie viele am Tag oder früher erledigt. */
  byPlannedWeekday: Array<{ planned: number; kept: number }>;
  byArea: Array<{ name: string; planned: number; kept: number; late: number }>;
  /** Aufgaben, die vor dem Abhaken verschoben wurden. */
  moved: { count: number; avgExtraDays: number };
}

const dayOf = (iso: string) => new Date(`${iso.slice(0, 10)}T00:00:00`);
const hasTimeOf = (planned: string) => planned.length > 10 && planned.includes('T');
/** Zwei Zeitpunkte gelten als dasselbe Abhaken, wenn sie so nah beieinander liegen. */
const SAME_EVENT_MS = 10 * 60_000;

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

/**
 * Erledigte Aufgaben aus dem Abhak-Protokoll, die im Todoist-Verlauf fehlen
 * (z. B. Vorkommen wiederkehrender Aufgaben), als zusätzliche Einträge.
 */
export function missingCompletions(completed: CompletedItem[], log: CompletionEntry[], range: { since: Date; until: Date }): CompletedItem[] {
  return log
    .filter((e) => {
      const at = new Date(e.at);
      if (at < range.since || at > range.until) return false;
      return !completed.some((c) => (c.task_id ?? c.id) === e.taskId
        && Math.abs(new Date(c.completed_at).getTime() - at.getTime()) <= SAME_EVENT_MS);
    })
    .map((e) => ({
      id: `log-${e.taskId}-${e.at}`,
      task_id: e.taskId,
      user_id: '',
      project_id: e.projectId,
      section_id: null,
      content: e.title,
      completed_at: e.at,
      labels: e.labels,
      due: e.planned ? { date: e.planned, timezone: null, string: '', lang: 'en', is_recurring: e.recurring } : null,
    }));
}

/** Der Plan einer erledigten Aufgabe: aus dem Protokoll, sonst aus Todoists Datum. */
export function plannedOf(c: CompletedItem, log: CompletionEntry[]): string | null | undefined {
  const taskId = c.task_id ?? c.id;
  const at = new Date(c.completed_at).getTime();
  const entry = log.find((e) => e.taskId === taskId && Math.abs(new Date(e.at).getTime() - at) <= SAME_EVENT_MS);
  if (entry) return entry.planned;
  const date = c.due?.date;
  if (!date) return null;
  /* Bei einer wiederkehrenden Aufgabe kann Todoist schon den nächsten Termin
     nennen; ein Plan nach dem Abhaktag ist dann keiner. */
  if (c.due?.is_recurring && dayOf(date) > dayOf(c.completed_at.slice(0, 10)) ) return undefined;
  return date;
}

export function timingOf(
  done: CompletedItem[],
  completions: CompletionEntry[],
  reschedules: RescheduleEntry[],
  areaOf: (c: CompletedItem) => string,
): Timing {
  const rows: PlanRow[] = [];
  let unplanned = 0;
  const sortedMoves = [...reschedules].sort((a, b) => a.at.localeCompare(b.at));
  for (const c of done) {
    const planned = plannedOf(c, completions);
    if (planned === null) { unplanned += 1; continue; }
    if (planned === undefined) continue;
    const taskId = c.task_id ?? c.id;
    const doneAt = new Date(c.completed_at);
    const hasTime = hasTimeOf(planned);
    /* Die Verschiebungen dieses Vorkommens: vor dem Abhaken und nach dem
       vorigen Abhaken derselben Aufgabe (bei Wiederholungen). */
    const previousDone = done
      .filter((o) => (o.task_id ?? o.id) === taskId && new Date(o.completed_at) < doneAt)
      .reduce<Date | null>((latest, o) => {
        const at = new Date(o.completed_at);
        return !latest || at > latest ? at : latest;
      }, null);
    const moves = sortedMoves.filter((m) => m.taskId === taskId && new Date(m.at) < doneAt
      && (!previousDone || new Date(m.at) > previousDone));
    const original = moves.length > 0 ? moves[0].from : null;
    const dayDiff = differenceInCalendarDays(doneAt, dayOf(planned));
    rows.push({
      taskId,
      title: c.content,
      area: areaOf(c),
      planned,
      hasTime,
      doneAt,
      dayDiff,
      minuteDiff: hasTime ? differenceInMinutes(doneAt, new Date(planned)) : null,
      original,
      originalDiff: original ? differenceInCalendarDays(doneAt, dayOf(original)) : null,
      moves: moves.length,
    });
  }
  rows.sort((a, b) => a.doneAt.getTime() - b.doneAt.getTime());

  const lateRows = rows.filter((r) => r.dayDiff > 0);
  /* Uhrzeit-Treue nur am geplanten Tag: Was Tage später kommt, zählt schon bei „später“. */
  const timedRows = rows.filter((r) => r.minuteDiff !== null && r.dayDiff === 0);
  const byPlannedWeekday = Array.from({ length: 7 }, () => ({ planned: 0, kept: 0 }));
  const areas = new Map<string, { name: string; planned: number; kept: number; late: number }>();
  for (const r of rows) {
    const w = byPlannedWeekday[dayOf(r.planned).getDay()];
    w.planned += 1;
    if (r.dayDiff <= 0) w.kept += 1;
    const a = areas.get(r.area) ?? { name: r.area, planned: 0, kept: 0, late: 0 };
    a.planned += 1;
    if (r.dayDiff <= 0) a.kept += 1; else a.late += 1;
    areas.set(r.area, a);
  }
  const movedRows = rows.filter((r) => r.originalDiff !== null);
  return {
    rows,
    unplanned,
    early: rows.filter((r) => r.dayDiff < 0).length,
    onDay: rows.filter((r) => r.dayDiff === 0).length,
    late: lateRows.length,
    avgLateDays: lateRows.length ? Math.round((lateRows.reduce((s, r) => s + r.dayDiff, 0) / lateRows.length) * 10) / 10 : 0,
    maxLateDays: lateRows.reduce((m, r) => Math.max(m, r.dayDiff), 0),
    timed: {
      count: timedRows.length,
      medianMinutes: median(timedRows.map((r) => r.minuteDiff as number)),
      close: timedRows.filter((r) => Math.abs(r.minuteDiff as number) <= 30).length,
      later: timedRows.filter((r) => (r.minuteDiff as number) > 30).length,
      earlier: timedRows.filter((r) => (r.minuteDiff as number) < -30).length,
    },
    byPlannedWeekday,
    byArea: [...areas.values()].sort((a, b) => b.planned - a.planned),
    moved: {
      count: movedRows.length,
      avgExtraDays: movedRows.length
        ? Math.round((movedRows.reduce((s, r) => s + (r.originalDiff as number), 0) / movedRows.length) * 10) / 10
        : 0,
    },
  };
}
