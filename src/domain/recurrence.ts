/**
 * Reading a recurrence out of what somebody typed.
 *
 * This recognises a recurrence. It does not resolve one: no function here ever
 * works out what date "every 3 days" lands on. That is Todoist's job, it is
 * the only place that can get it right across time zones and completions, and
 * the app's part is to hand over the phrase and keep out of the way.
 *
 * Which makes the whole contract a narrow one: find the phrase, say where it
 * sits so the caller can mark and strip it, and say which language it was read
 * in so the right parser is asked for on the other end.
 *
 * The grammar follows the list Todoist publishes, because that list is the
 * contract: a phrase this reads is a phrase their parser has to resolve, and
 * one it invents is a series moved to a date nobody asked for. What is covered:
 *
 *   every day / daily, every N hours|days|weeks|months|quarters|years
 *   every other <unit>, every week|month|quarter|year, quarterly
 *   every <weekday>[, <weekday>...], every weekday|workday|weekend
 *   every <N>th and lists of them — "every 2, 15, 27"
 *   every <month> <N> / every <N> <month>, and lists — "every 14 jan, 14 apr"
 *   every 1st|2nd|last <weekday>, every first|15th|last workday
 *   a time on the end — "at 9am", "at 20:00", "at noon", "à 9h30"
 *   a bound on the end — starting / until / ending / for N weeks
 *   "every!" on any of it
 *
 * Still refused: anything resting on a calendar we do not have (holidays,
 * "the workday after"), and any phrase containing "every" that none of the
 * above matches. A refusal costs a task that keeps its name. A wrong reading
 * costs a series, silently, and shows up weeks later.
 *
 * The phrase goes to Todoist as typed, in the language it was read in, with
 * one exception marked below where French word order has no counterpart in
 * anything Todoist documents and the canonical English form is sent instead.
 *
 * `every` and `every!` differ in where the next occurrence is counted from —
 * the current due date, or the day it was actually completed — which is why an
 * overdue `every! 3 days` jumps to three days from today rather than filling in
 * the ones it missed. Nothing here needs to know that to pass the phrase on,
 * but the caller shows it, so it is reported.
 */

import { MONTH_WORDS, WEEKDAY_WORDS } from './dateVocabulary';
import type { TodoistDue } from './types';
import { readGermanRecurrence } from './recurrenceDe';

export type RecurrenceLang = 'en' | 'fr';

export interface RecurrenceReading {
  /** The exact text that produced it, so the caller can mark and strip it. */
  matched: string;
  /** Where it starts in the string it was read from. */
  index: number;
  /** What to send as `due.string`, verbatim as typed. */
  string: string;
  /** The language to ask Todoist to parse `string` with. */
  lang: RecurrenceLang;
  /** True for `every!`: counted from completion rather than from the due date. */
  fromCompletion: boolean;
}

const fold = (text: string): string =>
  text.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

/* Each language's own words for the parts of a recurrence. The patterns below
   are built from these rather than written out per language, so a form is
   supported in both or in neither. */
interface Words {
  /** The word that opens a recurrence. `!` is handled separately. */
  every: string;
  /** "every other", where the language has a phrase for it. */
  other: string;
  hour: string; day: string; week: string; month: string;
  quarter: string; year: string;
  /** Working days, and the two days that are not. */
  workday: string; weekend: string;
  /** One-word recurrences: "daily", "quotidien". */
  shorthand: string[];
  weekdays: string[];
  months: string[];
  /** "1st", "2e" — a day of the month, written as a number. */
  ordinal: string;
  /** "first", "last" — a position within the month, written as a word. */
  position: string;
  /** "at", for a time of day. */
  at: string;
  /** Named times Todoist understands. */
  clockWords: string;
  /** Words that open a bound: starting, until, for three weeks. */
  bound: string;
}

const EN: Words = {
  every: '(?:every|each)',
  other: 'other',
  hour: 'hours?', day: 'days?', week: 'weeks?', month: 'months?',
  quarter: 'quarters?', year: 'years?',
  workday: '(?:weekdays?|workdays?|working days?)',
  weekend: 'weekends?',
  shorthand: ['daily', 'weekly', 'monthly', 'quarterly', 'yearly', 'annually', 'hourly'],
  weekdays: WEEKDAY_WORDS.en,
  months: MONTH_WORDS.en,
  ordinal: '\\d{1,2}(?:st|nd|rd|th)',
  position: '(?:first|second|third|fourth|fifth|last)',
  at: '(?:at|@)',
  clockWords: '(?:noon|midday|midnight|morning|afternoon|evening|night)',
  bound: '(?:starting|start(?:ing)? (?:on|from)|from|ending|end(?:ing)? on|until|till|til)',
};

const FR: Words = {
  every: '(?:tous les|toutes les|tous le|chaque)',
  other: 'deux',
  hour: 'heures?', day: 'jours?', week: 'semaines?', month: 'mois',
  quarter: 'trimestres?', year: '(?:ans?|annees?)',
  /* "jours de semaine" is the one people actually type for the working week —
     "jours ouvrés" is what a payroll system says. */
  workday: '(?:jours? ouvres?|jours? ouvrables?|jours? de semaine|jours? de la semaine)',
  weekend: '(?:week-?ends?|fins? de semaine)',
  shorthand: ['quotidien(?:ne)?', 'hebdomadaire', 'mensuel(?:le)?',
    'trimestriel(?:le)?', 'annuel(?:le)?'],
  weekdays: WEEKDAY_WORDS.fr,
  months: MONTH_WORDS.fr,
  ordinal: '\\d{1,2}(?:ers?|emes?|es?)',
  position: '(?:premiers?|1ers?|deuxiemes?|troisiemes?|quatriemes?|derniers?|dernieres?|premieres?)',
  at: '(?:a|vers)',
  clockWords: '(?:midi|minuit|matin|apres-midi|soir|nuit)',
  bound: '(?:a partir (?:du|de)|des le|jusqu(?:\\u2019|\')?au?|jusqua|pendant)',
};

const LANGS: Array<[RecurrenceLang, Words]> = [['en', EN], ['fr', FR]];

/**
 * Forms the grammar will not read.
 *
 * Short, now that the grammar covers what Todoist documents. What is left
 * either needs a calendar this app does not have, or is a bound whose own
 * shape Todoist does not define.
 */
const REFUSED = [
  /\b(?:holidays?|bank holiday|workday after|jours? feries?|ferie|feiertage?n?)\b/,
];

/**
 * Finds a recurrence in `raw`.
 *
 * Returns null when there is none, and also when there is one the grammar
 * refuses — the caller cannot tell the two apart and must not: both mean
 * "leave this text alone".
 */
export function readRecurrence(raw: string): RecurrenceReading | null {
  const text = fold(raw);
  if (REFUSED.some((pattern) => pattern.test(text))) return null;

  // Deutsch wird gelesen und als englische Regel an Todoist gegeben.
  const german = readGermanRecurrence(raw);
  if (german) return german;

  for (const [lang, w] of LANGS) {
    const reading = readIn(raw, text, lang, w);
    if (reading) return reading;
  }
  return null;
}

function readIn(
  raw: string, text: string, lang: RecurrenceLang, w: Words,
): RecurrenceReading | null {
  /* The trailing boundary is load-bearing. "mon" is Monday and also the first
     three letters of "month", so without it "every month" reads as a weekday
     and a task that repeats monthly quietly becomes one that repeats on
     Mondays. The same holds for "mar" against "mars" in French. */
  const weekday = `(?:${w.weekdays.join('|')})\\b`;
  const month = `(?:${w.months.join('|')})\\b`;
  const unit = `(?:${w.hour}|${w.day}|${w.week}|${w.month}|${w.quarter}|${w.year})\\b`;
  const every = `${w.every}(!)?`;
  const sep = '\\s*(?:,|and|et|&)\\s*';

  /* A clock time, and a bound, both optional and both allowed to trail any
     core form. They are part of the match rather than left behind, because a
     phrase half-taken is a task named "at 9am" with a rule that does not say
     when. The space before "am" belongs to "am": left loose at the end of the
     clock, it ate the space a bound needs, and "every mon at 9:15 ending…"
     lost its end without a word. */
  const clock = `\\d{1,2}(?:[:h.]\\d{2}|h)?(?:\\s*(?:am|pm))?`;
  const time = `(?:\\s+(?:${w.at}\\s*)?(?:${clock}|${w.clockWords}))?`;
  const datish = `(?:\\d{1,2}\\s+${month}|${month}\\s+\\d{1,2}|\\d{1,2}[/-]\\d{1,2}(?:[/-]\\d{2,4})?|\\d{4}-\\d{2}-\\d{2}|[a-z]+(?:\\s+\\d{1,2})?)`;
  const span = `(?:\\s+(?:for|pendant)\\s+\\d{1,3}\\s+${unit})`;
  const bound = `(?:${span}|\\s+${w.bound}\\s+${datish})*`;
  /* "of the month" trailing an ordinal weekday. Optional in English, where
     "every 1st monday" already says it, and the usual way to say it at all in
     French, where the month comes after the day rather than before it. */
  const ofMonth = `(?:\\s+(?:of\\s+(?:the|each|every)\\s+month|du mois|de chaque mois|des mois|par mois))?`;

  /* The core forms, longest first. Order is the whole correctness argument
     here: "every monday" is a prefix of "every monday, friday" and of "every
     1st monday", so a shorter form matching first would silently truncate a
     longer one and change what it means. */
  const cores = [
    /* An ordinal weekday written the way French writes it, with the article in
       front and the month behind: "le premier dimanche de chaque mois". There
       is no "tous les" to open it, so none of the forms below can reach it. */
    `(?:les?\\s+)?(?:${w.position}|${w.ordinal})\\s+${weekday}\\s+(?:de|du|des)\\s+(?:chaque\\s+)?mois`,
    // every 1st wed jan — an ordinal weekday pinned to a month
    `${every}\\s+(?:${w.ordinal}|${w.position})\\s+${weekday}\\s+${month}`,
    // every 1st wed, every last friday, every first workday, every 15th workday
    `${every}\\s+(?:${w.ordinal}|${w.position})\\s+(?:${weekday}|${w.workday})${ofMonth}`,
    // every 14 jan, 14 apr — dates in a year, possibly several
    `${every}\\s+\\d{1,2}\\s+${month}(?:${sep}\\d{1,2}\\s+${month})*`,
    `${every}\\s+${month}\\s+\\d{1,2}(?:${sep}${month}\\s+\\d{1,2})*`,
    // every 2 workdays — before "every 3 days", which would stop at "tous les 2 jours"
    `${every}\\s+\\d{1,3}\\s+${w.workday}`,
    // every last day — "chaque dernier jour"
    `${every}\\s+${w.position}\\s+${w.day}`,
    // every 2 weeks mon, thu — what Todoist writes back for "every 2 weeks on…" (#202)
    `${every}\\s+\\d{1,3}\\s+${w.week}\\s+(?:on\\s+)?${weekday}(?:${sep}${weekday})*`,
    // every mon, wed, fri
    `${every}\\s+${weekday}(?:${sep}${weekday})*`,
    // every 3 days, every 12 hours
    `${every}\\s+\\d{1,3}\\s+${unit}`,
    // every other week, every other friday
    `${every}\\s+${w.other}\\s+(?:${unit}|${weekday})`,
    // every weekday, every weekend
    `${every}\\s+(?:${w.workday}|${w.weekend})`,
    // every 2, 15, 27 — days of the month
    `${every}\\s+(?:${w.ordinal}|\\d{1,2})(?:${sep}(?:${w.ordinal}|\\d{1,2}))*(?!\\s*${unit})`,
    // every day, every week, every quarter
    `${every}\\s+${unit}`,
    // daily, quarterly, hebdomadaire
    `(?:${w.shorthand.join('|')})\\b`,
  ];

  for (const core of cores) {
    const match = text.match(new RegExp(`\\b${core}${time}${bound}`, 'i'));
    if (!match) continue;
    const matched = raw.slice(match.index!, match.index! + match[0].length).trim();
    return {
      matched,
      index: match.index!,
      string: canonical(matched, lang, w),
      lang: canonical(matched, lang, w) === matched ? lang : 'en',
      fromCompletion: match[1] === '!',
    };
  }

  return null;
}

/**
 * The phrase as Todoist should receive it.
 *
 * Almost always exactly what was typed: Todoist parses French, and a rule
 * echoed back in the language it was written in is the one the reader will
 * recognise in their own Todoist afterwards.
 *
 * The exception is the French ordinal weekday — "le premier dimanche de chaque
 * mois". Todoist documents "every 1st wed" and gives no French counterpart,
 * and French puts the month at the end where their grammar expects it at the
 * front, so passing it through is a guess about somebody else's parser. The
 * parts are unambiguous once matched, so the documented English form is built
 * from them instead. It is the one place a reader will see a rule they did not
 * type, which is the price of it landing on the right day.
 */
function canonical(matched: string, lang: RecurrenceLang, w: Words): string {
  if (lang !== 'fr') return matched;

  const text = fold(matched);
  const position = text.match(new RegExp(`\\b(${w.position}|${w.ordinal})\\s+(${w.weekdays.join('|')})\\b`, 'i'));
  if (!position) return matched;

  const ORDINALS: Record<string, string> = {
    premier: '1st', premiers: '1st', premiere: '1st', premieres: '1st',
    '1er': '1st', '1ers': '1st',
    deuxieme: '2nd', deuxiemes: '2nd', troisieme: '3rd', troisiemes: '3rd',
    quatrieme: '4th', quatriemes: '4th',
    dernier: 'last', derniers: 'last', derniere: 'last', dernieres: 'last',
  };
  const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

  const rank = ORDINALS[position[1]] ?? position[1].replace(/(?:er|eme|e)s?$/, 'th');
  const dayIndex = w.weekdays.findIndex((names) =>
    new RegExp(`^(?:${names})$`, 'i').test(position[2]));
  if (dayIndex < 0) return matched;

  return `every ${rank} ${DAYS[dayIndex]}`;
}

/**
 * Moving a single occurrence without ending the series.
 *
 * `due.string` is what Todoist treats as the truth, so sending a plain date in
 * it for a task that repeats replaces the rule with that one date and the
 * series stops — quietly, and for good. Every path in the app that gives a
 * task a day comes through here: the schedule menu, the three shortcuts, a
 * drop onto a column, the bulk bar. The rule goes back unchanged and only the
 * date moves, so this occurrence lands where it was put and the next one still
 * arrives.
 *
 * The time of day is kept too. A task due at 09:00 dragged to tomorrow is due
 * at 09:00 tomorrow, not at midnight — unless the new date names its own time,
 * which is the one case where the caller has been told otherwise — or the
 * time was taken off on purpose (`dropTime`, the picker's "Remove time").
 */
export function dueForDate(
  existing: TodoistDue | null | undefined,
  date: string,
  fallbackLang = 'en',
  { dropTime = false }: { dropTime?: boolean } = {},
): TodoistDue {
  const carriesTime = date.includes('T');
  const previousTime = !carriesTime && !dropTime && existing?.date.includes('T')
    ? existing.date.slice(existing.date.indexOf('T'))
    : '';
  const full = `${date}${previousTime}`;
  const recurring = existing?.is_recurring === true && !!existing.string;

  return {
    date: full,
    timezone: existing?.timezone ?? null,
    // The rule, not the date, whenever there is a rule to keep.
    string: recurring ? existing!.string : full,
    lang: existing?.lang ?? fallbackLang,
    is_recurring: recurring,
  };
}
