import { updateItem, type Command } from '@/api/commands';
import type { Item, Snapshot, TodoistDeadline, TodoistUser } from './types';

/**
 * Deadlines im Free-Tarif.
 *
 * Todoists eigenes Feld `deadline` gibt es nur in Pro/Business; ein Free-Konto
 * bekommt das Anlegen einer Aufgabe mit Deadline verweigert. Die App schreibt
 * die Deadline dort deshalb als letzte Zeile in die Beschreibung
 * („Deadline: 26.10.2026“). Die Zeile synchronisiert über Todoist auf jedes
 * Gerät, ist in Todoists eigenen Apps lesbar, und beim Einlesen macht die App
 * daraus wieder ein `deadline` und nimmt sie aus der angezeigten Beschreibung.
 * Der Rest der App sieht also nur ein ganz normales `item.deadline`.
 */

const NOTE_LINE = /^[ \t]*Deadline:[ \t]*(?:(\d{1,2})\.(\d{1,2})\.(\d{4})|(\d{4})-(\d{2})-(\d{2}))[ \t]*$/i;

const pad = (n: number): string => String(n).padStart(2, '0');

/** Das Datum einer Deadline-Zeile als "YYYY-MM-DD", oder null, wenn die Zeile keine (gültige) ist. */
function dateOfLine(line: string): string | null {
  const match = NOTE_LINE.exec(line);
  if (!match) return null;
  const [year, month, day] = match[1]
    ? [Number(match[3]), Number(match[2]), Number(match[1])]
    : [Number(match[4]), Number(match[5]), Number(match[6])];
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return `${year}-${pad(month)}-${pad(day)}`;
}

/** Die Deadline aus einer Beschreibung (die letzte gültige Zeile) und die Beschreibung ohne solche Zeilen. */
export function parseDeadlineNote(description: string): { date: string | null; rest: string } {
  let date: string | null = null;
  const kept: string[] = [];
  for (const line of description.split('\n')) {
    const found = dateOfLine(line);
    if (found) date = found;
    else kept.push(line);
  }
  return date ? { date, rest: kept.join('\n').replace(/\s+$/, '') } : { date: null, rest: description };
}

/** Die Beschreibung, wie sie zu Todoist geht: ohne alte Deadline-Zeile, mit der neuen am Ende. */
export function withDeadlineNote(description: string, deadline: TodoistDeadline | null | undefined): string {
  const { rest } = parseDeadlineNote(description);
  if (!deadline?.date) return rest;
  const [year, month, day] = deadline.date.split('-');
  const line = `Deadline: ${day}.${month}.${year}`;
  return rest ? `${rest}\n\n${line}` : line;
}

/** Eine Aufgabe, wie Todoist sie liefert, so wie die App sie zeigt: Deadline-Zeile → `deadline`. */
export function readDeadlineNote(item: Item): Item {
  if (!item.description || !/deadline:/i.test(item.description)) return item;
  const { date, rest } = parseDeadlineNote(item.description);
  if (!date) return item;
  return { ...item, description: rest, deadline: item.deadline ?? { date, lang: 'de' }, deadline_from_note: true };
}

/**
 * Pro: Deadlines, die noch als Zeile in der Beschreibung stehen, einmal ins
 * echte Feld schreiben – Beschreibung ohne die Zeile, Deadline als Feld. Nur
 * offene Aufgaben; erledigte bleiben, wie sie sind.
 */
export function noteDeadlineMigration(items: Record<string, Item>, skip: ReadonlySet<string> = new Set()): Command[] {
  return Object.values(items)
    .filter((item) => item.deadline_from_note && item.deadline && !item.checked && !item.is_deleted && !skip.has(item.id))
    .map((item) => updateItem(item.id, { description: item.description, deadline: item.deadline }));
}

/** Wie `canStoreDurations`: nur ein ausdrücklich freies Konto kann kein Deadline-Feld. */
export function canStoreDeadlines(user: Pick<TodoistUser, 'is_premium' | 'premium_status'> | null | undefined): boolean {
  if (user?.premium_status && user.premium_status !== 'not_premium') return true;
  return user?.is_premium !== false;
}

/**
 * Schreibt die Befehle so um, dass Todoist sie annimmt.
 *
 * Free: `deadline` geht als Zeile in die Beschreibung. Bei `item_update` wird
 * die ganze Beschreibung neu geschrieben, aus dem Stand nach der Änderung
 * (`after`), damit Beschreibung und Deadline einander nicht überschreiben.
 *
 * Pro: unverändert – nur wenn eine Beschreibung geht und die Aufgabe eine
 * Deadline hat, die bisher bloß als Zeile existierte, geht das Feld mit, sonst
 * wäre sie mit der Zeile weg.
 */
export function deadlinesToNotes(commands: Command[], after: Snapshot, canStore: boolean): Command[] {
  return commands.map((cmd) => {
    const args = cmd.args;
    if (cmd.type === 'item_add') {
      if (canStore || !('deadline' in args)) return cmd;
      const { deadline, ...rest } = args;
      const description = withDeadlineNote(String(args.description ?? ''), deadline as TodoistDeadline | null);
      return { ...cmd, args: { ...rest, ...(description ? { description } : {}) } };
    }
    if (cmd.type !== 'item_update' || !('deadline' in args || 'description' in args)) return cmd;
    const item = after.items[String(args.id)];
    if (canStore) {
      return 'description' in args && !('deadline' in args) && item?.deadline
        ? { ...cmd, args: { ...args, deadline: item.deadline } }
        : cmd;
    }
    const { deadline, ...rest } = args;
    if (!item && !('description' in args)) return { ...cmd, args: rest };
    const base = 'description' in args ? String(args.description ?? '') : item?.description ?? '';
    const typed = parseDeadlineNote(base).date;
    const target = 'deadline' in args
      ? (deadline as TodoistDeadline | null)
      : typed ? { date: typed, lang: 'de' } : item?.deadline ?? null;
    return { ...cmd, args: { ...rest, description: withDeadlineNote(base, target) } };
  });
}
