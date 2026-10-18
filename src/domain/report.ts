/**
 * Der Report: Rückblick auf einen Zeitraum.
 *
 * Alles hier wird aus vorhandenen Daten berechnet, ohne externen Dienst: den
 * erledigten Aufgaben aus dem Todoist-Verlauf, den offenen Aufgaben, dem
 * Umplan-Protokoll der App (lib/rescheduleLog.ts) und den Verschiebe-
 * Kommentaren (↻) von „Neu planen“. Die Verhaltensanalyse und die Learnings
 * sind feste Regeln über diese Zahlen – nachvollziehbar und jedes Mal gleich.
 *
 * Texte stehen nicht hier, sondern als Schlüssel (`report.learn.<id>.*`,
 * `report.analysis.<id>`) in den Übersetzungen; die Funktionen liefern nur,
 * welcher Text mit welchen Werten gilt.
 */
import { addDays, differenceInCalendarDays, endOfDay, startOfDay } from 'date-fns';
import type { RescheduleEntry } from '@/lib/rescheduleLog';
import { estimateOf } from './estimates';
import { focusScore } from './insights';
import { areaTitle, parseListLabel, splitListName } from './lists';
import { isRescheduleComment } from './replan';
import { daysOf, rangeFor, type Range } from './periods';
import { toApiDate } from './dates';
import type { CompletedItem, Item, Note, Project } from './types';
import { toDisplayPriority } from './types';

export interface ReportMove {
  taskId: string;
  at: Date;
  /** `yyyy-MM-dd`, leer, wenn nur der Kommentar davon weiß. */
  from: string;
  to: string | null;
  title: string;
  projectId: string;
  labels: string[];
  reason?: string;
}

export interface MovedTask {
  taskId: string;
  title: string;
  count: number;
  /** Wie viele Tage es insgesamt nach hinten ging. */
  daysPushed: number;
  reasons: string[];
  /** Schon erledigt (im Zeitraum oder davor), noch offen, oder nicht mehr da. */
  state: 'done' | 'open' | 'gone';
}

export interface Learning {
  id: LearningId;
  tone: 'good' | 'warn' | 'tip';
  params: Record<string, string | number>;
}

export type LearningId =
  | 'noData' | 'trendUp' | 'trendDown' | 'bestDay' | 'bestTime' | 'lateWork' | 'weekend'
  | 'overplanning' | 'chronicMovers' | 'goodFlow' | 'onTimeHigh' | 'onTimeLow' | 'overdue'
  | 'focusLow' | 'focusHigh' | 'estimates' | 'topReason' | 'gaps' | 'areaFocus';

export type AnalysisId =
  | 'volume' | 'volumeTrend' | 'rhythm' | 'planning' | 'planningNone' | 'reliability' | 'focus' | 'areas';

export interface AnalysisLine {
  id: AnalysisId;
  params: Record<string, string | number>;
}

export type DaySlot = 'morning' | 'midday' | 'afternoon' | 'evening' | 'night';

export interface Report {
  range: Range;
  /** Tage im Zeitraum, die schon begonnen haben (zählt für Durchschnitte). */
  elapsedDays: number;
  completed: {
    count: number;
    previousCount: number;
    /** Veränderung zum gleich langen Zeitraum davor in Prozent, `null` ohne Vergleich. */
    change: number | null;
    minutes: number;
    withEstimate: number;
    perDay: number;
    byDay: Array<{ date: string; count: number }>;
    /** 0 = Sonntag … 6 = Samstag, wie `Date.getDay()`. */
    byWeekday: number[];
    byHour: number[];
    bySlot: Record<DaySlot, number>;
    byArea: Array<{ name: string; count: number }>;
    byPriority: { p1: number; p2: number; p3: number; p4: number };
    focusScore: number;
    activeDays: number;
    /** Mit Datum erledigt: am Tag oder früher / später. */
    onTime: number;
    late: number;
    tasks: CompletedItem[];
  };
  moves: {
    count: number;
    tasks: number;
    postponed: number;
    pulledForward: number;
    undated: number;
    /** Nur aus einem Kommentar bekannt (Richtung unklar). */
    unknown: number;
    avgDaysPushed: number;
    top: MovedTask[];
    reasons: Array<{ text: string; count: number }>;
    byWeekday: number[];
  };
  open: {
    overdue: number;
    oldest: Array<{ id: string; title: string; days: number }>;
  };
  analysis: AnalysisLine[];
  learnings: Learning[];
}

export interface ReportInput {
  range: Range;
  completed: CompletedItem[];
  previous: CompletedItem[];
  log: RescheduleEntry[];
  items: Record<string, Item>;
  projects: Record<string, Project>;
  notes: Record<string, Note>;
  now?: Date;
}

const inRange = (at: Date, range: Range) => at >= range.since && at <= range.until;
const dayKey = (iso: string) => iso.slice(0, 10);

/** Der Grund aus einem Verschiebe-Kommentar: alles nach dem ersten „: “ (Uhrzeiten haben keinen Abstand). */
export function reasonOf(content: string): string {
  const text = content.trim().replace(/^↻\s*/, '');
  const at = text.indexOf(': ');
  return (at >= 0 ? text.slice(at + 2) : text).trim();
}

/**
 * Die Verschiebungen im Zeitraum: das Protokoll der App, ergänzt um die
 * Verschiebe-Kommentare. Steht zu einem Kommentar ein Protokolleintrag in
 * der Nähe (±15 Min.), ist es dieselbe Verschiebung und bekommt nur den Grund.
 */
export function movesIn(
  range: Range,
  log: RescheduleEntry[],
  notes: Record<string, Note>,
  items: Record<string, Item>,
): ReportMove[] {
  const moves: ReportMove[] = log
    .map((e) => ({ ...e, at: new Date(e.at) }))
    .filter((e) => !Number.isNaN(e.at.getTime()) && inRange(e.at, range));
  const comments = Object.values(notes)
    .filter((n) => !n.is_deleted && n.item_id && isRescheduleComment(n.content))
    .map((n) => ({ taskId: n.item_id as string, at: new Date(n.posted_at), reason: reasonOf(n.content) }))
    .filter((c) => !Number.isNaN(c.at.getTime()) && inRange(c.at, range))
    .sort((a, b) => a.at.getTime() - b.at.getTime());
  const window = 15 * 60_000;
  for (const c of comments) {
    const match = moves.find((m) => m.taskId === c.taskId && !m.reason
      && Math.abs(m.at.getTime() - c.at.getTime()) <= window);
    if (match) {
      match.reason = c.reason;
      continue;
    }
    const item = items[c.taskId];
    moves.push({
      taskId: c.taskId, at: c.at, from: '', to: null,
      title: item?.content ?? '', projectId: item?.project_id ?? '', labels: item?.labels ?? [],
      reason: c.reason,
    });
  }
  return moves.sort((a, b) => a.at.getTime() - b.at.getTime());
}

/** Der Bereich einer Aufgabe: aus dem Projektnamen („Privat_Geplant“) oder dem Listen-Label, sonst das Projekt. */
export function areaOf(projectId: string, labels: string[], projects: Record<string, Project>): string {
  const project = projects[projectId];
  const fromProject = project ? splitListName(project.name) : null;
  if (fromProject) return areaTitle(fromProject.area);
  for (const label of labels) {
    const parsed = parseListLabel(label);
    if (parsed) return areaTitle(parsed.area);
  }
  if (project?.parent_id && projects[project.parent_id]?.is_folder) return projects[project.parent_id].name;
  return project?.name ?? '–';
}

export function slotOf(hour: number): DaySlot {
  if (hour >= 5 && hour < 11) return 'morning';
  if (hour >= 11 && hour < 14) return 'midday';
  if (hour >= 14 && hour < 18) return 'afternoon';
  if (hour >= 18 && hour < 23) return 'evening';
  return 'night';
}

const pct = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 100) : 0);
const indexOfMax = (values: number[]) => values.reduce((best, v, i) => (v > values[best] ? i : best), 0);

export function buildReport(input: ReportInput): Report {
  const now = input.now ?? new Date();
  const { range, items, projects } = input;
  const today = startOfDay(now);

  /* ------------------------------ erledigt ------------------------------ */
  const done = input.completed.filter((c) => inRange(new Date(c.completed_at), range));
  const lastCounted = range.until < now ? range.until : now;
  const elapsedDays = Math.max(1, differenceInCalendarDays(lastCounted, range.since) + 1);
  const byWeekday = Array<number>(7).fill(0);
  const byHour = Array<number>(24).fill(0);
  const bySlot: Record<DaySlot, number> = { morning: 0, midday: 0, afternoon: 0, evening: 0, night: 0 };
  const perDayMap = new Map<string, number>();
  const areaMap = new Map<string, number>();
  const byPriority = { p1: 0, p2: 0, p3: 0, p4: 0 };
  let minutes = 0;
  let withEstimate = 0;
  let onTime = 0;
  let late = 0;
  for (const c of done) {
    const at = new Date(c.completed_at);
    byWeekday[at.getDay()] += 1;
    byHour[at.getHours()] += 1;
    bySlot[slotOf(at.getHours())] += 1;
    const key = toApiDate(at);
    perDayMap.set(key, (perDayMap.get(key) ?? 0) + 1);
    const area = areaOf(c.project_id, c.labels ?? [], projects);
    areaMap.set(area, (areaMap.get(area) ?? 0) + 1);
    byPriority[`p${toDisplayPriority(c.priority ?? 1)}` as 'p1'] += 1;
    const est = estimateOf({ labels: c.labels ?? [], duration: c.duration });
    if (est) { minutes += est; withEstimate += 1; }
    if (c.due?.date) {
      if (key <= dayKey(c.due.date)) onTime += 1; else late += 1;
    }
  }
  const byDay = daysOf(range).filter((d) => d <= now).map((d) => ({ date: toApiDate(d), count: perDayMap.get(toApiDate(d)) ?? 0 }));
  const previousCount = input.previous.length;
  const change = previousCount > 0 ? Math.round(((done.length - previousCount) / previousCount) * 100) : null;

  /* ----------------------------- umgeplant ----------------------------- */
  const moves = movesIn(range, input.log, input.notes, items);
  const doneIds = new Set([...input.completed, ...input.previous].map((c) => c.task_id ?? c.id));
  const perTask = new Map<string, MovedTask>();
  const moveWeekday = Array<number>(7).fill(0);
  let postponed = 0;
  let pulledForward = 0;
  let undated = 0;
  let unknown = 0;
  let pushedDays = 0;
  const reasonMap = new Map<string, { text: string; count: number }>();
  for (const m of moves) {
    moveWeekday[m.at.getDay()] += 1;
    let pushed = 0;
    if (!m.from) unknown += 1;
    else if (m.to === null) undated += 1;
    else {
      const diff = differenceInCalendarDays(new Date(`${m.to}T00:00:00`), new Date(`${m.from}T00:00:00`));
      if (diff > 0) { postponed += 1; pushed = diff; pushedDays += diff; } else pulledForward += 1;
    }
    const item = items[m.taskId];
    const entry = perTask.get(m.taskId) ?? {
      taskId: m.taskId,
      title: item?.content ?? m.title,
      count: 0,
      daysPushed: 0,
      reasons: [],
      state: item && !item.checked ? 'open' : (doneIds.has(m.taskId) || item?.checked) ? 'done' : 'gone',
    } satisfies MovedTask;
    entry.count += 1;
    entry.daysPushed += pushed;
    if (m.reason) entry.reasons.push(m.reason);
    perTask.set(m.taskId, entry);
    if (m.reason) {
      const norm = m.reason.toLowerCase().replace(/[.!…\s]+$/u, '').replace(/\s+/g, ' ');
      const r = reasonMap.get(norm) ?? { text: m.reason.replace(/[.!…\s]+$/u, ''), count: 0 };
      r.count += 1;
      reasonMap.set(norm, r);
    }
  }
  const top = [...perTask.values()].sort((a, b) => b.count - a.count || b.daysPushed - a.daysPushed);
  const reasons = [...reasonMap.values()].sort((a, b) => b.count - a.count);

  /* ------------------------------- offen ------------------------------- */
  const overdueItems = Object.values(items)
    .filter((i) => !i.checked && !i.is_deleted && i.due?.date && new Date(`${dayKey(i.due.date)}T00:00:00`) < today)
    .map((i) => ({ id: i.id, title: i.content, days: differenceInCalendarDays(today, new Date(`${dayKey(i.due!.date)}T00:00:00`)) }))
    .sort((a, b) => b.days - a.days);

  const report: Report = {
    range,
    elapsedDays,
    completed: {
      count: done.length,
      previousCount,
      change,
      minutes,
      withEstimate,
      perDay: Math.round((done.length / elapsedDays) * 10) / 10,
      byDay,
      byWeekday,
      byHour,
      bySlot,
      byArea: [...areaMap.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count),
      byPriority,
      focusScore: focusScore(done),
      activeDays: byDay.filter((d) => d.count > 0).length,
      onTime,
      late,
      tasks: [...done].sort((a, b) => a.completed_at.localeCompare(b.completed_at)),
    },
    moves: {
      count: moves.length,
      tasks: perTask.size,
      postponed,
      pulledForward,
      undated,
      unknown,
      avgDaysPushed: postponed > 0 ? Math.round((pushedDays / postponed) * 10) / 10 : 0,
      top,
      reasons,
      byWeekday: moveWeekday,
    },
    open: { overdue: overdueItems.length, oldest: overdueItems.slice(0, 5) },
    analysis: [],
    learnings: [],
  };
  report.analysis = analyse(report);
  report.learnings = learn(report, now);
  return report;
}

/** Die Verhaltensanalyse: ein paar Sätze, die die Zahlen in Worte fassen. */
export function analyse(r: Report): AnalysisLine[] {
  const out: AnalysisLine[] = [];
  const c = r.completed;
  out.push({ id: 'volume', params: { count: c.count, perDay: c.perDay, active: c.activeDays, days: r.elapsedDays } });
  if (c.change !== null) out.push({ id: 'volumeTrend', params: { change: c.change, previous: c.previousCount } });
  if (c.count >= 3) {
    const slot = (Object.entries(c.bySlot) as Array<[DaySlot, number]>).sort((a, b) => b[1] - a[1])[0][0];
    out.push({ id: 'rhythm', params: { weekday: indexOfMax(c.byWeekday), slot } });
  }
  if (r.moves.count > 0) {
    out.push({ id: 'planning', params: {
      moves: r.moves.count, tasks: r.moves.tasks, postponed: r.moves.postponed, avg: r.moves.avgDaysPushed,
    } });
  } else {
    out.push({ id: 'planningNone', params: {} });
  }
  if (c.onTime + c.late > 0) out.push({ id: 'reliability', params: { share: pct(c.onTime, c.onTime + c.late), late: c.late } });
  if (c.count > 0) out.push({ id: 'focus', params: { score: c.focusScore, p1: c.byPriority.p1 } });
  if (c.byArea.length > 1) {
    out.push({ id: 'areas', params: { first: c.byArea[0].name, share: pct(c.byArea[0].count, c.count), second: c.byArea[1].name } });
  }
  return out;
}

/** Die Learnings: Regeln über die Zahlen, Warnungen zuerst. */
export function learn(r: Report, now = new Date()): Learning[] {
  const c = r.completed;
  const m = r.moves;
  const out: Learning[] = [];
  if (c.count === 0 && m.count === 0) {
    return [{ id: 'noData', tone: 'tip', params: {} }];
  }
  if (m.count >= 3 && m.postponed + m.undated + m.unknown > c.count * 0.5) {
    out.push({ id: 'overplanning', tone: 'warn', params: { moves: m.count, done: c.count, perDay: Math.max(1, Math.round(c.perDay)) } });
  }
  const chronic = m.top.filter((t) => t.count >= 3 && t.state !== 'done');
  if (chronic.length > 0) {
    out.push({ id: 'chronicMovers', tone: 'warn', params: {
      count: chronic.length, names: chronic.slice(0, 3).map((t) => `„${t.title}“`).join(', '), max: chronic[0].count,
    } });
  }
  if (r.open.overdue >= 5) out.push({ id: 'overdue', tone: 'warn', params: { count: r.open.overdue } });
  if (c.onTime + c.late >= 5 && pct(c.onTime, c.onTime + c.late) < 50) {
    out.push({ id: 'onTimeLow', tone: 'warn', params: { share: pct(c.onTime, c.onTime + c.late) } });
  }
  const evening = c.byHour.slice(21).reduce((a, b) => a + b, 0) + c.byHour.slice(0, 5).reduce((a, b) => a + b, 0);
  if (c.count >= 5 && evening / c.count > 0.25) out.push({ id: 'lateWork', tone: 'warn', params: { share: pct(evening, c.count) } });
  const weekend = c.byWeekday[0] + c.byWeekday[6];
  const hasWeekend = daysOf(r.range).some((d) => d <= now && (d.getDay() === 0 || d.getDay() === 6));
  if (hasWeekend && c.count >= 5 && weekend / c.count > 0.3) out.push({ id: 'weekend', tone: 'warn', params: { share: pct(weekend, c.count) } });
  if (c.change !== null && c.previousCount >= 3 && c.change <= -25) out.push({ id: 'trendDown', tone: 'tip', params: { change: Math.abs(c.change) } });
  if (m.reasons.length > 0 && m.reasons[0].count >= 2) {
    out.push({ id: 'topReason', tone: 'tip', params: { reason: m.reasons[0].text, count: m.reasons[0].count } });
  }
  if (c.count >= 5 && c.focusScore < 40) out.push({ id: 'focusLow', tone: 'tip', params: { score: c.focusScore } });
  if (c.count >= 5 && pct(c.withEstimate, c.count) < 30) out.push({ id: 'estimates', tone: 'tip', params: { share: pct(c.withEstimate, c.count) } });
  const gaps = c.byDay.filter((d) => d.count === 0).length;
  if (r.elapsedDays >= 7 && gaps >= Math.max(3, Math.round(r.elapsedDays * 0.4))) {
    out.push({ id: 'gaps', tone: 'tip', params: { gaps, days: r.elapsedDays } });
  }
  if (c.count >= 5) {
    out.push({ id: 'bestDay', tone: 'tip', params: { weekday: indexOfMax(c.byWeekday), count: Math.max(...c.byWeekday) } });
    const slot = (Object.entries(c.bySlot) as Array<[DaySlot, number]>).sort((a, b) => b[1] - a[1])[0];
    out.push({ id: 'bestTime', tone: 'tip', params: { slot: slot[0], share: pct(slot[1], c.count) } });
  }
  if (c.byArea.length > 1 && c.count >= 5 && c.byArea[0].count / c.count >= 0.8) {
    out.push({ id: 'areaFocus', tone: 'tip', params: { area: c.byArea[0].name, share: pct(c.byArea[0].count, c.count) } });
  }
  if (c.change !== null && c.previousCount >= 3 && c.change >= 20) out.push({ id: 'trendUp', tone: 'good', params: { change: c.change } });
  if (c.count >= 5 && m.count <= c.count * 0.1) out.push({ id: 'goodFlow', tone: 'good', params: { moves: m.count, done: c.count } });
  if (c.onTime + c.late >= 5 && pct(c.onTime, c.onTime + c.late) >= 80) {
    out.push({ id: 'onTimeHigh', tone: 'good', params: { share: pct(c.onTime, c.onTime + c.late) } });
  }
  if (c.count >= 5 && c.focusScore >= 70) out.push({ id: 'focusHigh', tone: 'good', params: { score: c.focusScore } });
  return out;
}

/** Beispiel-Verschiebungen für den Demomodus, aus den offenen Demo-Aufgaben. */
export function demoReschedules(items: Record<string, Item>, now = new Date()): RescheduleEntry[] {
  const open = Object.values(items).filter((i) => !i.checked && i.due?.date).slice(0, 6);
  const reasons = ['Keine Zeit', 'Wartet auf Rückmeldung', 'Keine Zeit', 'Zu müde', 'Wichtigeres kam dazwischen'];
  const out: RescheduleEntry[] = [];
  open.forEach((item, index) => {
    const times = index === 0 ? 4 : index === 1 ? 3 : 1;
    for (let k = 0; k < times; k += 1) {
      const at = addDays(startOfDay(now), -(k * 2 + index));
      at.setHours(9 + index, 15);
      out.push({
        taskId: item.id, at: at.toISOString(), from: toApiDate(at), to: toApiDate(addDays(at, 1 + (k % 2))),
        title: item.content, projectId: item.project_id, labels: item.labels, recurring: false,
        reason: reasons[(index + k) % reasons.length],
      });
    }
  });
  return out;
}

/** Die Schnellwahl über dem Report. */
export const QUICK_RANGES = [
  'today', 'yesterday', 'thisWeek', 'lastWeek', 'thisMonth', 'lastMonth', 'last30', 'thisQuarter', 'thisYear', 'custom',
] as const;
export type QuickRange = (typeof QUICK_RANGES)[number];

/** Der Zeitraum einer Schnellwahl; Wochen beginnen am Starttag des Todoist-Kontos. */
export function quickRange(quick: QuickRange, custom: Range | null, startDay: number, now = new Date()): Range {
  switch (quick) {
    case 'today': return rangeFor('day', 0, null, startDay, now);
    case 'yesterday': return rangeFor('day', -1, null, startDay, now);
    case 'thisWeek': return rangeFor('week', 0, null, startDay, now);
    case 'lastWeek': return rangeFor('week', -1, null, startDay, now);
    case 'thisMonth': return rangeFor('month', 0, null, startDay, now);
    case 'lastMonth': return rangeFor('month', -1, null, startDay, now);
    case 'last30': return { since: startOfDay(addDays(now, -29)), until: endOfDay(now) };
    case 'thisQuarter': return rangeFor('quarter', 0, null, startDay, now);
    case 'thisYear': return rangeFor('year', 0, null, startDay, now);
    case 'custom': return custom ?? rangeFor('week', 0, null, startDay, now);
  }
}
