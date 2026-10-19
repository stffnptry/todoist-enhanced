/**
 * Abhak-Protokoll, für den Report („geplant gegen abgehakt“).
 *
 * Todoist kennt den Zeitpunkt des Abhakens, aber nicht immer, wofür die
 * Aufgabe in dem Moment geplant war: Bei einer wiederkehrenden Aufgabe steht
 * danach schon der nächste Termin da. Deshalb merkt sich die App bei jedem
 * Abhaken, das über sie läuft, Datum und Uhrzeit, die die Aufgabe gerade
 * hatte – nur auf diesem Mac, die letzten 400 Tage. Was in der Todoist-App
 * abgehakt wird, liefert der Verlauf von Todoist (ohne Gewähr für den Plan).
 */
import type { Command } from '@/api/commands';
import type { Snapshot } from '@/domain/types';

export interface CompletionEntry {
  taskId: string;
  /** Wann abgehakt wurde (ISO). */
  at: string;
  /** Wofür die Aufgabe da geplant war: `yyyy-MM-dd` oder mit Uhrzeit `yyyy-MM-ddTHH:mm:ss`; `null` = ohne Datum. */
  planned: string | null;
  title: string;
  projectId: string;
  labels: string[];
  recurring: boolean;
}

const KEY = 'enhanced:completion-log';
const KEEP_DAYS = 400;
const MAX_ENTRIES = 8000;
/** Wird ein Abhaken so schnell zurückgenommen, zählt es nicht. */
const UNDO_WINDOW_MS = 3 * 60_000;

/* Überspringen einer wiederkehrenden Aufgabe schickt denselben Befehl wie
   Abhaken (item_close). Wer überspringt, meldet die Aufgaben vorher hier an. */
const skipping = new Set<string>();
export function skipNextCompletion(ids: readonly string[]): void {
  ids.forEach((id) => skipping.add(id));
}

const CLOSE = new Set(['item_close', 'item_complete']);

/** Die Abhak-Vorgänge in einer Reihe von Befehlen, mit dem Plan von vorher. */
export function completionsFrom(before: Snapshot, commands: readonly Command[], now = new Date()): CompletionEntry[] {
  const out: CompletionEntry[] = [];
  const seen = new Set<string>();
  for (const cmd of commands) {
    if (!CLOSE.has(cmd.type)) continue;
    const id = cmd.args.id;
    if (typeof id !== 'string' || seen.has(id)) continue;
    seen.add(id);
    const item = before.items[id];
    if (!item || item.checked) continue;
    out.push({
      taskId: id,
      at: now.toISOString(),
      planned: item.due?.date ?? null,
      title: item.content,
      projectId: item.project_id,
      labels: item.labels ?? [],
      recurring: Boolean(item.due?.is_recurring),
    });
  }
  return out;
}

/** Die Aufgaben, die diese Befehle wieder öffnen. */
export function reopenedBy(commands: readonly Command[]): string[] {
  return commands
    .filter((cmd) => cmd.type === 'item_uncomplete' && typeof cmd.args.id === 'string')
    .map((cmd) => cmd.args.id as string);
}

/** Neue Einträge dazu, kurz danach wieder Geöffnetes heraus, Altes weg. */
export function mergeCompletions(
  log: CompletionEntry[],
  added: CompletionEntry[],
  reopened: string[],
  now = new Date(),
): CompletionEntry[] {
  let next = [...log, ...added];
  for (const id of reopened) {
    for (let i = next.length - 1; i >= 0; i -= 1) {
      if (next[i].taskId !== id) continue;
      if (now.getTime() - new Date(next[i].at).getTime() <= UNDO_WINDOW_MS) next = next.filter((_, j) => j !== i);
      break;
    }
  }
  const oldest = now.getTime() - KEEP_DAYS * 24 * 60 * 60_000;
  return next.filter((e) => new Date(e.at).getTime() >= oldest).slice(-MAX_ENTRIES);
}

const isEntry = (e: unknown): e is CompletionEntry => {
  const v = e as Partial<CompletionEntry> | null;
  return !!v && typeof v.taskId === 'string' && typeof v.at === 'string'
    && (v.planned === null || typeof v.planned === 'string') && typeof v.title === 'string';
};

export function loadCompletions(): CompletionEntry[] {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    return Array.isArray(raw)
      ? raw.filter(isEntry).map((e) => ({ ...e, labels: Array.isArray(e.labels) ? e.labels : [], projectId: e.projectId ?? '' }))
      : [];
  } catch {
    return [];
  }
}

/** Schreibt Abhaken und Wieder-Öffnen dieser Befehle ins Protokoll. */
export function recordCompletions(before: Snapshot, commands: readonly Command[]): void {
  const added = completionsFrom(before, commands).filter((e) => !skipping.delete(e.taskId));
  const reopened = reopenedBy(commands);
  if (added.length === 0 && reopened.length === 0) return;
  try {
    localStorage.setItem(KEY, JSON.stringify(mergeCompletions(loadCompletions(), added, reopened)));
  } catch {
    /* Ohne Speicher fehlt der Plan nur im Report. */
  }
}
