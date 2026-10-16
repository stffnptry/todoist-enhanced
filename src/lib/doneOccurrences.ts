/**
 * Erledigte Vorkommen wiederkehrender Aufgaben, für den Kalender.
 *
 * Wird eine wiederkehrende Aufgabe abgehakt, springt sie in Todoist zum
 * nächsten Termin; das erledigte Vorkommen gibt es dort nicht als eigene
 * Aufgabe. Damit es im Kalender trotzdem als erledigt stehen bleibt, merkt
 * sich die App, welche Aufgabe zu welcher Zeit abgehakt wurde (nur auf diesem
 * Mac, die letzten Wochen).
 */

export interface DoneOccurrence {
  taskId: string;
  /** Die Zeit, zu der das Vorkommen geplant war (ISO). */
  start: string;
}

const KEY = 'enhanced:calendar-done-occurrences';
const KEEP_DAYS = 60;

/** Nur die letzten Wochen, jedes Vorkommen einmal. */
export function pruneOccurrences(list: DoneOccurrence[], now: number): DoneOccurrence[] {
  const oldest = now - KEEP_DAYS * 24 * 60 * 60_000;
  const seen = new Set<string>();
  return list.filter((o) => {
    const key = `${o.taskId}@${o.start}`;
    const at = new Date(o.start).getTime();
    if (seen.has(key) || !Number.isFinite(at) || at < oldest) return false;
    seen.add(key);
    return true;
  });
}

export function loadOccurrences(): DoneOccurrence[] {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    if (!Array.isArray(raw)) return [];
    return pruneOccurrences(
      raw.filter((o): o is DoneOccurrence => !!o && typeof o.taskId === 'string' && typeof o.start === 'string'),
      Date.now(),
    );
  } catch {
    return [];
  }
}

export function saveOccurrences(list: DoneOccurrence[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    /* Ohne Speicher gilt die Markierung nur bis zum Neustart. */
  }
}
