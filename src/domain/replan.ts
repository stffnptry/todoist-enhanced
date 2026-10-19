import { addDays, nextMonday, startOfDay } from 'date-fns';
import { dueDate, toApiDate } from './dates';
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
export function replanShortcuts(now = new Date()): { today: string; tomorrow: string; dayAfter: string; nextWeek: string } {
  const today = startOfDay(now);
  return {
    today: toApiDate(today),
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

/**
 * Überfällig: mit Uhrzeit ab dieser Uhrzeit, sonst ab dem Tag danach – wie
 * die Gruppe „Im Rückstand“ auf Heute.
 */
export function isOverdue(item: Item, now = new Date()): boolean {
  const was = dueDate(item);
  if (!was) return false;
  return dueTimeOf(item) ? was < now : was < startOfDay(now);
}

/**
 * Womit das Datum beim Umplanen vorbelegt ist: Überfälliges holt man meist
 * auf heute, was heute ansteht schiebt man meist auf morgen.
 */
export function defaultReplanDate(item: Item, now = new Date()): string {
  const { today, tomorrow } = replanShortcuts(now);
  return isOverdue(item, now) ? today : tomorrow;
}

/**
 * Die offenen, überfälligen Unteraufgaben (in jeder Tiefe) einer Aufgabe. Sie
 * ziehen beim Umplanen mit auf den neuen Termin; Unteraufgaben mit einem
 * späteren Termin oder ohne Termin bleiben, wie sie sind.
 */
export function overdueDescendants(id: string, items: Record<string, Item>, now = new Date()): Item[] {
  const children = new Map<string, Item[]>();
  for (const item of Object.values(items)) {
    if (!item.parent_id || item.is_deleted) continue;
    const list = children.get(item.parent_id) ?? [];
    list.push(item);
    children.set(item.parent_id, list);
  }
  const found: Item[] = [];
  const seen = new Set<string>([id]);
  const walk = (parent: string) => {
    for (const child of children.get(parent) ?? []) {
      if (seen.has(child.id)) continue;
      seen.add(child.id);
      if (!child.checked && isOverdue(child, now)) found.push(child);
      walk(child.id);
    }
  };
  walk(id);
  return found;
}
