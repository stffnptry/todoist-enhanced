import { addDays, nextMonday, startOfDay } from 'date-fns';
import { toApiDate } from './dates';
import type { Item } from './types';

/**
 * „Neu planen“: eine Ansicht Aufgabe für Aufgabe durchgehen und jede
 * erledigen, löschen oder verschieben. Wer verschiebt, schreibt dazu, warum –
 * das landet als Kommentar an der Aufgabe und beginnt mit diesem Zeichen,
 * woran die App ihn wiedererkennt (auch in einer anderen Sprache, und auch
 * wenn der Text danach von Hand geändert wurde).
 */
export const RESCHEDULE_MARK = '↻';

/** Ein Verschiebe-Kommentar, wie die App ihn schreibt. */
export const isRescheduleComment = (content: string | null | undefined): boolean =>
  !!content && content.trimStart().startsWith(RESCHEDULE_MARK);

/**
 * Der Kommentartext: Zeichen, die Zeile „Verschoben von … auf …“ (schon
 * übersetzt) und der Grund. Der Grund ist Pflicht – ohne gibt es nichts.
 */
export function rescheduleCommentText(headline: string, reason: string): string | null {
  const why = reason.trim();
  if (!why) return null;
  return `${RESCHEDULE_MARK} ${headline.trim()}: ${why}`;
}

/**
 * Die Aufgabe, die als Nächstes dran ist: die erste der Ansicht, die in dieser
 * Runde noch nicht behandelt wurde. Eine wiederkehrende Aufgabe, die nach dem
 * Erledigen gleich wieder heute fällig ist, kommt so nicht ein zweites Mal.
 */
export function nextToReplan(items: readonly Item[], handled: ReadonlySet<string>): Item | undefined {
  return items.find((item) => !item.checked && !handled.has(item.id));
}

/** Die Schnellwahl im Dialog, als `yyyy-MM-dd`. */
export function replanShortcuts(now = new Date()): { tomorrow: string; dayAfter: string; nextWeek: string } {
  const today = startOfDay(now);
  return {
    tomorrow: toApiDate(addDays(today, 1)),
    dayAfter: toApiDate(addDays(today, 2)),
    nextWeek: toApiDate(nextMonday(today)),
  };
}

/** Die Uhrzeit einer Fälligkeit als `HH:mm`, oder leer bei einem reinen Datum. */
export function dueTimeOf(item: Item): string {
  const date = item.due?.date ?? '';
  const at = date.indexOf('T');
  return at < 0 ? '' : date.slice(at + 1, at + 6);
}
