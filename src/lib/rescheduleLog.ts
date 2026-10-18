/**
 * Umplan-Protokoll, für den Report.
 *
 * Todoist merkt sich nicht, wie oft eine Aufgabe verschoben wurde: Nach dem
 * Verschieben steht nur das neue Datum da. Damit der Report sagen kann, was
 * oft umgeplant wurde, schreibt die App jede Datumsänderung mit, die über sie
 * läuft (Ziehen, Datumswahl, „Neu planen“, Mitteilungs-Knöpfe …) – nur auf
 * diesem Mac, die letzten 400 Tage. Verschiebungen in der Todoist-App selbst
 * sieht sie nicht; dafür zählt der Report zusätzlich die Verschiebe-Kommentare
 * (↻), die „Neu planen“ an die Aufgabe hängt.
 */
import type { Command } from '@/api/commands';
import type { Item, Snapshot } from '@/domain/types';

export interface RescheduleEntry {
  taskId: string;
  /** Wann verschoben wurde (ISO). */
  at: string;
  /** Der Tag vorher und nachher, `yyyy-MM-dd`; `null` = ohne Datum. */
  from: string;
  to: string | null;
  /** Titel und Ort zum Zeitpunkt der Änderung: Die Aufgabe kann später weg sein. */
  title: string;
  projectId: string;
  labels: string[];
  recurring: boolean;
  /** Der Grund aus einem Verschiebe-Kommentar, wenn es einen gibt. */
  reason?: string;
}

const KEY = 'enhanced:reschedule-log';
const KEEP_DAYS = 400;
const MAX_ENTRIES = 5000;
/** Wird eine Änderung so schnell zurückgenommen (Rückgängig), zählt sie nicht. */
const UNDO_WINDOW_MS = 3 * 60_000;

const dayOf = (date: string | null | undefined): string | null => (date ? date.slice(0, 10) : null);

/**
 * Die Verschiebungen, die eine Reihe von Befehlen auslöst: jede Aufgabe, deren
 * Fälligkeitstag sich zwischen vorher und nachher ändert. Eine Aufgabe, die
 * erst ein Datum bekommt, ist eingeplant, nicht umgeplant; eine, die ihr Datum
 * verliert, zählt (sie wurde auf „irgendwann“ geschoben). Eine reine
 * Uhrzeitänderung am selben Tag zählt nicht.
 */
export function reschedulesFrom(
  before: Snapshot,
  after: Snapshot,
  commands: readonly Command[],
  now = new Date(),
): RescheduleEntry[] {
  const ids = new Set<string>();
  for (const cmd of commands) {
    if (cmd.type !== 'item_update' || !('due' in cmd.args)) continue;
    const id = cmd.args.id;
    if (typeof id === 'string') ids.add(id);
  }
  const out: RescheduleEntry[] = [];
  for (const id of ids) {
    const was: Item | undefined = before.items[id];
    const is: Item | undefined = after.items[id];
    if (!was || !is || was.checked) continue;
    const from = dayOf(was.due?.date);
    const to = dayOf(is.due?.date);
    if (!from || from === to) continue;
    out.push({
      taskId: id,
      at: now.toISOString(),
      from,
      to,
      title: was.content,
      projectId: was.project_id,
      labels: was.labels ?? [],
      recurring: Boolean(was.due?.is_recurring),
    });
  }
  return out;
}

/**
 * Neue Einträge ins Protokoll: Eine Verschiebung, die kurz darauf genau
 * zurückgenommen wird, löscht die erste, statt eine zweite zu zählen. Alte
 * Einträge fallen heraus.
 */
export function mergeReschedules(log: RescheduleEntry[], added: RescheduleEntry[], now = new Date()): RescheduleEntry[] {
  const next = [...log];
  for (const entry of added) {
    const lastIndex = findLastIndex(next, (e) => e.taskId === entry.taskId);
    const last = lastIndex >= 0 ? next[lastIndex] : null;
    if (last && last.to === entry.from && last.from === entry.to
      && new Date(entry.at).getTime() - new Date(last.at).getTime() <= UNDO_WINDOW_MS) {
      next.splice(lastIndex, 1);
      continue;
    }
    next.push(entry);
  }
  const oldest = now.getTime() - KEEP_DAYS * 24 * 60 * 60_000;
  return next.filter((e) => new Date(e.at).getTime() >= oldest).slice(-MAX_ENTRIES);
}

function findLastIndex<T>(list: T[], test: (value: T) => boolean): number {
  for (let i = list.length - 1; i >= 0; i -= 1) if (test(list[i])) return i;
  return -1;
}

const isEntry = (e: unknown): e is RescheduleEntry => {
  const v = e as Partial<RescheduleEntry> | null;
  return !!v && typeof v.taskId === 'string' && typeof v.at === 'string' && typeof v.from === 'string'
    && (v.to === null || typeof v.to === 'string') && typeof v.title === 'string';
};

export function loadReschedules(): RescheduleEntry[] {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    return Array.isArray(raw)
      ? raw.filter(isEntry).map((e) => ({ ...e, labels: Array.isArray(e.labels) ? e.labels : [], projectId: e.projectId ?? '' }))
      : [];
  } catch {
    return [];
  }
}

/** Schreibt die Verschiebungen dieser Befehle ins Protokoll (nichts, wenn es keine gibt). */
export function recordReschedules(before: Snapshot, after: Snapshot, commands: readonly Command[]): void {
  const added = reschedulesFrom(before, after, commands);
  if (added.length === 0) return;
  try {
    localStorage.setItem(KEY, JSON.stringify(mergeReschedules(loadReschedules(), added)));
  } catch {
    /* Ohne Speicher fehlt die Verschiebung nur im Report. */
  }
}
