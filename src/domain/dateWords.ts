import { readNaturalDate } from './nlp';
import { toApiDate } from './dates';
import type { Locale } from '@/i18n';

/**
 * The date phrases worth offering while somebody types one.
 *
 * Deliberately short, and written in the words the parser already reads, so
 * every suggestion in the list is guaranteed to produce the day it shows. The
 * parser understands a good deal more than this — "in 3 days", "12/04" — but
 * those are things you type, not things you pick: a list is only useful while
 * it is short enough to read without moving your eyes.
 */
const WORDS: Record<Locale, string[]> = {
  en: [
    'today', 'tomorrow', 'next week',
    'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday',
  ],
  fr: [
    "aujourd'hui", 'demain', 'semaine prochaine',
    'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche',
  ],
  de: [
    'heute', 'morgen', 'übermorgen', 'nächste Woche',
    'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag', 'Sonntag',
  ],
};

const fold = (text: string): string =>
  text.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

export interface DateSuggestion {
  /**
   * The phrase this came from, when it came from one.
   *
   * Null for a bare day of the month, where there is no phrase to show: the
   * caller writes the date out instead, in whatever format the reader chose.
   */
  word: string | null;
  /** `yyyy-MM-dd`. */
  date: string;
}

/** How many fit under the field without turning it into a page of its own. */
const LIMIT = 3;

/**
 * What the typing could still turn into.
 *
 * Two kinds of answer. A few letters are the start of a word — "to" is today
 * or tomorrow, "tom" only one of them. A number on its own is a day of the
 * month, and the useful question there is *which* month: typing 15 on the
 * sixteenth almost certainly means next month, so the next three occurrences
 * are offered rather than one guessed at.
 */
export function dateSuggestions(
  typed: string,
  interfaceLocale: Locale,
  now = new Date(),
): DateSuggestion[] {
  const query = fold(typed.trim());
  if (!query) return [];

  const digits = query.match(/^(\d{1,2})$/);
  if (digits) return daysOfMonth(Number(digits[1]), now);

  const others = (['en', 'fr', 'de'] as const).filter((lang) => lang !== interfaceLocale);
  const out: DateSuggestion[] = [];

  /* Every language, whatever the interface is set to — somebody reading
     French may well type "tomorrow" — with the interface's own words first,
     because those are the ones they are most likely to mean. */
  for (const word of [...WORDS[interfaceLocale], ...others.flatMap((lang) => WORDS[lang])]) {
    if (!fold(word).startsWith(query)) continue;
    const reading = readNaturalDate(word, now);
    // A phrase the parser cannot read back is a suggestion that would lie.
    if (!reading) continue;
    out.push({ word, date: reading.date });
    if (out.length === LIMIT) break;
  }

  return out;
}

/**
 * The next few times that day of the month comes round.
 *
 * Today counts as the next one: typing the date it already is means today,
 * not a month's time. A day the month is too short for — the 31st of
 * September — is skipped rather than rolled into October, which would offer
 * the same date twice.
 */
function daysOfMonth(day: number, now: Date): DateSuggestion[] {
  if (day < 1 || day > 31) return [];

  const out: DateSuggestion[] = [];
  const start = now.getDate() <= day ? 0 : 1;

  for (let ahead = start; out.length < LIMIT && ahead < start + 14; ahead += 1) {
    const at = new Date(now.getFullYear(), now.getMonth() + ahead, day);
    if (at.getDate() !== day) continue;
    out.push({ word: null, date: toApiDate(at) });
  }

  return out;
}
