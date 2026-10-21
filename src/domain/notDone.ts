import type { CompletionEntry } from '@/lib/completionLog';
import type { Item, Note } from './types';

/**
 * „Nicht erledigt“: Eine Aufgabe ist vom Tisch, ohne dass sie getan wurde.
 * Die App hängt den Grund als Kommentar an die Aufgabe und hakt sie dann in
 * Todoist ab – bei einer wiederkehrenden Aufgabe nur dieses Vorkommen. Der
 * Kommentar beginnt mit diesem Zeichen, woran die App ihn wiedererkennt
 * (auch in einer anderen Sprache, und auch wenn der Text danach von Hand
 * geändert wurde). Der Report führt solche Aufgaben getrennt von den
 * erledigten.
 */
export const NOT_DONE_MARK = '⊘';

/** Ein Nicht-erledigt-Kommentar, wie die App ihn schreibt. */
export const isNotDoneComment = (content: string | null | undefined): boolean =>
  !!content && content.trimStart().startsWith(NOT_DONE_MARK);

/** Der Kommentartext: Zeichen, „Nicht erledigt“ (übersetzt) und der Grund. Ohne Grund gibt es nichts. */
export function notDoneCommentText(headline: string, reason: string): string | null {
  const why = reason.trim();
  if (!why) return null;
  return `${NOT_DONE_MARK} ${headline.trim()}: ${why}`;
}

/** Der Grund aus einem Nicht-erledigt-Kommentar: alles nach dem ersten „: “. */
export function notDoneReasonOf(content: string): string {
  const text = content.trim().replace(new RegExp(`^${NOT_DONE_MARK}\\s*`), '');
  const at = text.indexOf(': ');
  return (at >= 0 ? text.slice(at + 2) : text).trim();
}

export interface NotDoneTask {
  taskId: string;
  /** Wann die Aufgabe als nicht erledigt abgeschlossen wurde. */
  at: Date;
  title: string;
  reason: string;
  projectId: string;
  labels: string[];
  /** Wofür sie da geplant war (`yyyy-MM-dd[THH:mm:ss]`), wenn bekannt. */
  planned: string | null;
  recurring: boolean;
}

/** Abhaken und Kommentar liegen ein paar Sekunden auseinander; so weit gilt es als dasselbe. */
export const NOT_DONE_WINDOW_MS = 15 * 60_000;

/**
 * Alle Nicht-erledigt-Vorgänge: aus dem Abhak-Protokoll dieses Macs, ergänzt
 * um die Kommentare (von einem anderen Gerät, oder wenn das Protokoll fehlt).
 * Ein Kommentar an einer Aufgabe, die wieder offen ist und nicht wiederkehrt,
 * zählt nicht – da wurde das Abhaken zurückgenommen.
 */
export function notDoneTasks(
  log: readonly CompletionEntry[],
  notes: Record<string, Note>,
  items: Record<string, Item>,
): NotDoneTask[] {
  const out: NotDoneTask[] = log
    .filter((e) => typeof e.notDone === 'string')
    .map((e) => ({
      taskId: e.taskId, at: new Date(e.at), title: e.title, reason: e.notDone as string,
      projectId: e.projectId, labels: e.labels, planned: e.planned, recurring: e.recurring,
    }))
    .filter((e) => !Number.isNaN(e.at.getTime()));
  for (const note of Object.values(notes)) {
    if (note.is_deleted || !note.item_id || !isNotDoneComment(note.content)) continue;
    const at = new Date(note.posted_at);
    if (Number.isNaN(at.getTime())) continue;
    const taskId = note.item_id;
    if (out.some((e) => e.taskId === taskId && Math.abs(e.at.getTime() - at.getTime()) <= NOT_DONE_WINDOW_MS)) continue;
    const item = items[taskId];
    if (item && !item.checked && !item.is_deleted && !item.due?.is_recurring) continue;
    out.push({
      taskId, at, title: item?.content ?? '', reason: notDoneReasonOf(note.content),
      projectId: item?.project_id ?? '', labels: item?.labels ?? [], planned: null,
      recurring: Boolean(item?.due?.is_recurring),
    });
  }
  return out.sort((a, b) => a.at.getTime() - b.at.getTime());
}

/** Ob ein Abhaken (Aufgabe, Zeitpunkt) eines dieser Nicht-erledigt-Vorgänge ist. */
export function isNotDoneCompletion(taskId: string, at: Date, notDone: readonly NotDoneTask[]): boolean {
  return notDone.some((e) => e.taskId === taskId && Math.abs(e.at.getTime() - at.getTime()) <= NOT_DONE_WINDOW_MS);
}
