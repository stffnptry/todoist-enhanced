import { parseISO } from 'date-fns';
import type { Item } from './types';
import { hasTime } from './dates';

/**
 * Erinnerungen im Free-Tarif.
 *
 * Eigene Erinnerungen sind in Todoist eine Pro-Funktion. Die Schnelleingabe
 * schreibt `!14:00` oder `!30m` deshalb als Zeile in die Beschreibung,
 * genau wie die Deadline („Deadline: …“), und die Mac-App plant daraus ihre
 * Mitteilung. Die Zeile bleibt sichtbar: So lässt sie sich in der Beschreibung
 * ändern oder löschen, und sie überlebt jedes Bearbeiten der Beschreibung.
 *
 *   Erinnerung: 14:00               → am Fälligkeitstag um 14:00
 *   Erinnerung: 21.10.2026 14:00    → genau dann
 *   Erinnerung: 30 Min. vorher      → 30 Minuten vor der Fälligkeitszeit
 */

export type ReminderNote =
  | { kind: 'time'; time: string }
  | { kind: 'at'; date: string; time: string }
  | { kind: 'before'; minutes: number };

const pad = (n: number): string => String(n).padStart(2, '0');

const LINE = /^[ \t]*Erinnerung:[ \t]*(.+?)[ \t]*$/i;
const TIME = /^(\d{1,2})(?::(\d{2}))?(?:[ \t]*Uhr)?$/i;
const AT = /^(\d{1,2})\.(\d{1,2})\.(\d{4})[ \t]+(\d{1,2}):(\d{2})(?:[ \t]*Uhr)?$/i;
const BEFORE = /^(\d{1,4})[ \t]*(m|min|min\.|minuten|h|std|std\.|stunden?)[ \t]*(?:vorher)?$/i;

/** "9" oder "9:30" als "09:30", oder null, wenn es keine Uhrzeit ist. */
export function clockTime(hours: string, minutes = '00'): string | null {
  const h = Number(hours);
  const m = Number(minutes);
  if (h > 23 || m > 59) return null;
  return `${pad(h)}:${pad(m)}`;
}

/** "30m", "2h", "45 min" als Minuten, oder null. */
export function offsetMinutes(amount: string, unit: string): number | null {
  const n = Number(amount);
  if (!n) return null;
  return /^(h|std|stunde)/i.test(unit) ? n * 60 : n;
}

function readLine(text: string): ReminderNote | null {
  const at = AT.exec(text);
  if (at) {
    const [, d, mo, y, h, mi] = at;
    const time = clockTime(h, mi);
    const date = new Date(Number(y), Number(mo) - 1, Number(d));
    if (!time || date.getMonth() !== Number(mo) - 1) return null;
    return { kind: 'at', date: `${y}-${pad(Number(mo))}-${pad(Number(d))}`, time };
  }
  const time = TIME.exec(text);
  if (time) {
    const value = clockTime(time[1], time[2]);
    return value ? { kind: 'time', time: value } : null;
  }
  const before = BEFORE.exec(text);
  if (before) {
    const minutes = offsetMinutes(before[1], before[2]);
    return minutes ? { kind: 'before', minutes } : null;
  }
  return null;
}

/** Alle Erinnerungszeilen einer Beschreibung. */
export function readReminderNotes(description: string | undefined): ReminderNote[] {
  if (!description || !/erinnerung:/i.test(description)) return [];
  return description.split('\n').flatMap((line) => {
    const match = LINE.exec(line);
    const note = match ? readLine(match[1]) : null;
    return note ? [note] : [];
  });
}

export function reminderLine(note: ReminderNote): string {
  if (note.kind === 'before') {
    return note.minutes % 60 === 0
      ? `Erinnerung: ${note.minutes / 60} Std. vorher`
      : `Erinnerung: ${note.minutes} Min. vorher`;
  }
  if (note.kind === 'time') return `Erinnerung: ${note.time}`;
  const [y, m, d] = note.date.split('-');
  return `Erinnerung: ${d}.${m}.${y} ${note.time}`;
}

/** Die Beschreibung mit den Erinnerungszeilen am Ende. */
export function withReminderNotes(description: string, notes: ReminderNote[]): string {
  if (notes.length === 0) return description;
  const lines = notes.map(reminderLine).join('\n');
  return description ? `${description}\n\n${lines}` : lines;
}

/**
 * Eine Uhrzeit-Erinnerung an einer Aufgabe ohne Datum hat keinen Tag, an dem
 * sie gilt. Sie wird beim Anlegen auf heute festgelegt, oder auf morgen, wenn
 * die Uhrzeit heute schon vorbei ist.
 */
export function anchorReminder(note: ReminderNote, hasDate: boolean, now: Date): ReminderNote {
  if (note.kind !== 'time' || hasDate) return note;
  const [h, m] = note.time.split(':').map(Number);
  const day = new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, m);
  if (day.getTime() <= now.getTime()) day.setDate(day.getDate() + 1);
  return {
    kind: 'at',
    date: `${day.getFullYear()}-${pad(day.getMonth() + 1)}-${pad(day.getDate())}`,
    time: note.time,
  };
}

/** Wann die Erinnerung einer Aufgabe fällig ist (Epoch-ms), oder null, wenn sie keinen Zeitpunkt hat. */
export function reminderMoment(note: ReminderNote, item: Pick<Item, 'due'>): number | null {
  if (note.kind === 'at') return parseISO(`${note.date}T${note.time}:00`).getTime();
  if (!item.due) return null;
  if (note.kind === 'time') return parseISO(`${item.due.date.slice(0, 10)}T${note.time}:00`).getTime();
  if (!hasTime(item.due)) return null;
  return parseISO(item.due.date).getTime() - note.minutes * 60_000;
}
