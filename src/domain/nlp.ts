import { addMonths } from 'date-fns';
import { toApiDate, type DateFormat } from './dates';
import { MONTH_WORDS } from './dateVocabulary';

/**
 * Reading a date out of what somebody typed.
 *
 * This is deliberately a short list of phrases people actually use rather than
 * a general date grammar: anything it is not sure about it leaves alone, so a
 * task called "Call mum about March" keeps its name. The caller can switch it
 * off entirely, which is why it is a separate pass from `#project`, `p1` and
 * `@tag` — those are explicit syntax, not a guess.
 */

export interface DateReading {
  /** `yyyy-MM-dd`, or with `THH:mm:ss` when a time of day was given. */
  date: string;
  /** The exact text that produced it, as it appears, so the caller can strip it. */
  matched: string;
  /** Where that text starts in what was read. */
  index: number;
  /** True when the phrase carried a time as well as a day. */
  hasTime: boolean;
}

const WEEKDAYS: Record<'en' | 'fr' | 'de', string[]> = {
  en: ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'],
  fr: ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'],
  de: ['sonntag', 'montag', 'dienstag', 'mittwoch', 'donnerstag', 'freitag', 'samstag|sonnabend'],
};

/**
 * Was vor einem deutschen Wochentag stehen darf und mit ihm verschwindet:
 * „am Freitag“, „nächsten Montag“, „bis Freitag“. So bleibt kein „am“ im Namen.
 */
const DE_WEEKDAY_LEAD = '(?:(?:bis )?(?:zum |am |nachsten |nachster |kommenden |diesen )|bis )?';

/**
 * „jeden Montag“, „jeden Morgen“, „alle Freitage“ sind Wiederholungen bzw.
 * Tageszeiten, keine einzelnen Tage. Lieber nichts lesen als einen Termin
 * erfinden und „jeden“ im Aufgabennamen stehen lassen.
 */
const DE_NOT_A_DAY = '(?<!\\b(?:jeden|jede|jedes|alle|immer|guten|am|den|der|diesen|zum) )';

/**
 * For each month, every word either language has for it, longest first so
 * "juillet" is tried before "juil". Exact words and their abbreviations, never
 * a stem: reading a month from its first three letters made "14 juillet" June
 * and "2 maisons" the 2nd of May (#123).
 */
const MONTH_ALTERNATIVES: string[] = Array.from({ length: 12 }, (_, month) =>
  [...MONTH_WORDS.en[month].split('|'), ...MONTH_WORDS.fr[month].split('|'),
    ...MONTH_WORDS.de[month].split('|')]
    .sort((a, b) => b.length - a.length)
    .join('|'));

export interface DateReadingOptions {
  /**
   * The order a numeric date is written in. `12/03` is the 12th of March
   * unless this says month first, and only `'mdy'` does. The language never
   * decides it: it is a setting.
   */
  dateFormat?: DateFormat;
}

/**
 * Lowercased and stripped of accents, one character in for one character out.
 *
 * The length has to survive: every phrase below is found in the folded text
 * and reported as a position in the original, and "après-demain" folded the
 * ordinary way is one character shorter than it started — which is a mark
 * drawn a character to the left of the word it belongs to.
 */
const fold = (text: string): string =>
  text
    .toLowerCase()
    .split('')
    .map((ch) => ch.normalize('NFD')[0] ?? ch)
    .join('');

const addDays = (from: Date, days: number): Date => {
  const out = new Date(from);
  out.setDate(out.getDate() + days);
  return out;
};

export interface TimeReading {
  hours: number;
  minutes: number;
  /** Where the time sits in the text it was read from. */
  start: number;
  end: number;
}

/** A time of day appearing anywhere in the phrase: "at 14:00", "2pm", "à 9h30". */
export function readTime(text: string): TimeReading | null {
  const span = (match: RegExpMatchArray) => {
    /* The pattern may have eaten the space in front of the time, and that
       space belongs to the sentence rather than to the reading. */
    const raw = match[0];
    const lead = raw.length - raw.trimStart().length;
    return { start: match.index! + lead, end: match.index! + raw.length };
  };

  const ampm = text.match(/\b(?:at|à|a)?\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i);
  if (ampm) {
    let hours = Number(ampm[1]) % 12;
    if (ampm[3].toLowerCase() === 'pm') hours += 12;
    return { hours, minutes: Number(ampm[2] ?? 0), ...span(ampm) };
  }
  /* Deutsch: „8 Uhr“, „8:30 Uhr“, „um 8.30 Uhr“ – und „um 8“ / „um 8:30“
     ohne „Uhr“. Das „um“ gehört zur Uhrzeit, damit es nicht im Namen bleibt. */
  const german = text.match(/\b(?:um\s+)?(\d{1,2})(?:[:.](\d{2}))?\s*uhr\b/i)
    ?? text.match(/\bum\s+(\d{1,2})(?:[:.](\d{2}))?(?![.:]?\d)/i);
  if (german) {
    const hours = Number(german[1]);
    const minutes = Number(german[2] ?? 0);
    if (hours <= 23 && minutes <= 59) return { hours, minutes, ...span(german) };
  }
  const hm = text.match(/\b(?:at|à|a|um)?\s*(\d{1,2})\s*[h:]\s*(\d{2})?\b/i);
  if (hm) {
    const hours = Number(hm[1]);
    if (hours > 23) return null;
    return { hours, minutes: Number(hm[2] ?? 0), ...span(hm) };
  }

  /*
   * A part of the day is a time too.
   *
   * "demain matin" is a sentence anybody writes and nobody means vaguely: it
   * is tomorrow at nine. The hours below are the ones Todoist itself uses, so
   * a task written here and the same task written there land at the same time.
   * Afternoon is tried before noon, because "après-midi" contains it.
   */
  const parts: Array<[RegExp, number]> = [
    [/\b(?:apres[- ]midi|afternoon|nachmittags?)\b/i, 14],
    /* „Morgen“ ist auf Deutsch auch „morgen“ (der nächste Tag); als Tageszeit
       gilt es nur direkt nach „heute“. „morgen früh“ ist morgen um 9. */
    [/\b(?:matin|matinee|morning|vormittags?|fruh|morgens)\b|(?<=\bheute\s{1,3})morgen\b/i, 9],
    [/\b(?:soir|soiree|evening|tonight|abends?)\b/i, 19],
    [/\b(?:midi|noon|mittags?)\b/i, 12],
    [/\b(?:nuit|night|nachts?)\b/i, 21],
  ];
  for (const [pattern, hours] of parts) {
    const match = text.match(pattern);
    if (match) return { hours, minutes: 0, ...span(match) };
  }

  return null;
}

/** „in einer Woche“, „in zwei Tagen“: Zahlwörter, die man wirklich tippt. */
const GERMAN_COUNTS: Record<string, number> = {
  ein: 1, eine: 1, einem: 1, einer: 1, zwei: 2, drei: 3, vier: 4, funf: 5,
  sechs: 6, sieben: 7, acht: 8, neun: 9, zehn: 10,
};

/** How far a time may sit from its day and still belong to it. */
const TIME_GAP = 3;

/**
 * Finds a date phrase in `raw`.
 *
 * Returns null when nothing is recognised, which is the common case and the
 * one that must never do damage.
 */
export function readNaturalDate(
  raw: string, now = new Date(), options: DateReadingOptions = {},
): DateReading | null {
  const text = fold(raw);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  /**
   * A reading, reported as the exact stretch of `raw` that produced it.
   *
   * The phrase and the time are two matches that have to be given back as one
   * range: the caller marks that range and takes it out of the task's name, so
   * a range stitched together from two strings — "demain" and " 12:14" with the
   * space counted twice — is a range that cannot be found in what was typed,
   * and the whole reading used to be dropped on the floor because of it.
   */
  const found = (day: Date, match: RegExpMatchArray): DateReading => {
    const start = match.index!;
    const end = start + match[0].length;
    const time = readTime(text);

    /* A time is part of this phrase when it is beside it. One further off in
       the sentence belongs to the sentence: "12:14 is the deadline, call
       tomorrow" is a task for tomorrow, at no particular hour. */
    const attached = time
      && (time.start - end <= TIME_GAP && time.start >= end
        || start - time.end <= TIME_GAP && time.end <= start
        /* Or the same words twice: "ce soir" is a day and an hour written as
           one phrase, and the hour sits inside what the day matched. */
        || time.start < end && time.end > start);

    if (!time || !attached) {
      return { date: toApiDate(day), matched: raw.slice(start, end), index: start, hasTime: false };
    }

    const from = Math.min(start, time.start);
    const to = Math.max(end, time.end);
    const pad = (n: number) => String(n).padStart(2, '0');
    return {
      date: `${toApiDate(day)}T${pad(time.hours)}:${pad(time.minutes)}:00`,
      matched: raw.slice(from, to),
      index: from,
      hasTime: true,
    };
  };

  // "today" / "tomorrow" / the day after
  const plain: Array<[RegExp, number]> = [
    /* Today, said by naming a part of it. "ce soir" is the commonest way
       anybody writes tonight, and it names the hour at the same time — the
       time reader takes the same words a moment later. */
    [/\b(ce soir|cette nuit|ce matin|cet? apres[- ]midi|this (?:morning|afternoon|evening)|tonight)\b/, 0],
    [/\b(today|aujourd'?hui|auj|heute)\b/, 0],
    [new RegExp(`\\b(?:tomorrow|demain|${DE_NOT_A_DAY}(?:bis )?morgen)\\b`), 1],
    [/\b(after tomorrow|apres-demain|apres demain|(?:bis )?ubermorgen)\b/, 2],
  ];
  for (const [pattern, offset] of plain) {
    const match = text.match(pattern);
    if (match) return found(addDays(today, offset), match);
  }

  // "next week" / "la semaine prochaine" — the coming Monday
  const nextWeek = text.match(/\b(next week|semaine prochaine|la semaine prochaine|(?:in der )?(?:nachsten|kommenden) woche|(?:nachste|kommende) woche)\b/);
  if (nextWeek) {
    return found(addDays(today, ((8 - today.getDay()) % 7) || 7), nextWeek);
  }

  // "in 3 days" / "dans 2 semaines"
  /* „in 30 Minuten“, „in 2 Stunden“, „in einer halben Stunde“, "in 45 minutes",
     « dans 2 heures »: ab jetzt gerechnet, auf die Minute genau. */
  const soon = text.match(/\b(?:in|dans)\s+(?:(einer halben stunde|einer viertelstunde|anderthalb stunden|half an hour|une demi-heure)|(\d{1,3}|ein|eine|einem|einer|zwei|drei|vier|funf|sechs|sieben|acht|neun|zehn|a|an|one|un|une)\s+(minuten?|minutes?|mins?|stunden?|std|hours?|hrs?|heures?))\b/);
  if (soon) {
    let minutes: number;
    if (soon[1]) {
      minutes = { 'einer halben stunde': 30, 'einer viertelstunde': 15, 'anderthalb stunden': 90, 'half an hour': 30, 'une demi-heure': 30 }[soon[1]] ?? 0;
    } else {
      const count = /^\d+$/.test(soon[2]) ? Number(soon[2]) : (GERMAN_COUNTS[soon[2]] ?? 1);
      minutes = /^(?:min|minute)/.test(soon[3]) ? count : count * 60;
    }
    if (minutes > 0) {
      const at = new Date(now.getTime() + minutes * 60_000);
      const pad = (n: number) => String(n).padStart(2, '0');
      return {
        date: `${toApiDate(at)}T${pad(at.getHours())}:${pad(at.getMinutes())}:00`,
        matched: raw.slice(soon.index!, soon.index! + soon[0].length),
        index: soon.index!,
        hasTime: true,
      };
    }
  }

  // „in 3 Tagen“ / „in einer Woche“ / „in zwei Monaten“
  const relative = text.match(/\b(?:in|dans)\s+(\d{1,3}|un|une|a|an|one|einem|einer|ein|eine|zwei|drei|vier|funf|sechs|sieben|acht|neun|zehn)\s+(days?|jours?|weeks?|semaines?|months?|mois|tag(?:en?)?|wochen?|monat(?:en?)?)\b/);
  if (relative) {
    const count = /^\d+$/.test(relative[1]) ? Number(relative[1]) : (GERMAN_COUNTS[relative[1]] ?? 1);
    const weeks = relative[2].startsWith('week') || relative[2].startsWith('semaine') || relative[2].startsWith('woche');
    const months = relative[2].startsWith('month') || relative[2] === 'mois' || relative[2].startsWith('monat');
    return found(months ? addMonths(today, count) : addDays(today, count * (weeks ? 7 : 1)), relative);
  }

  // A weekday name, in any language: the next one that is not today.
  for (const [lang, names] of Object.entries(WEEKDAYS)) {
    const lead = lang === 'de' ? `${DE_NOT_A_DAY}${DE_WEEKDAY_LEAD}` : '(?:next |prochain |le )?';
    for (let index = 0; index < names.length; index += 1) {
      const name = fold(names[index]);
      const match = text.match(new RegExp(`\\b${lead}(?:${name})\\b`));
      if (!match) continue;
      const delta = ((index - today.getDay() + 7) % 7) || 7;
      return found(addDays(today, delta), match);
    }
  }

  /* "10 sept", "3 mars", "1er juillet", "July 1st", "sept 10": the next
     occurrence of that calendar day. Both languages are read on purpose, and
     each month is matched by its exact words with a boundary after them. When
     a sentence holds more than one, the one that starts first is the one read;
     the caller reads on from there for a later one. */
  let earliest: { at: number; day: Date; match: RegExpMatchArray } | null = null;
  for (let month = 0; month < 12; month += 1) {
    const words = `(?:${MONTH_ALTERNATIVES[month]})\\.?(?![a-z])`;
    // „15. Oktober“ und „15.Oktober“ schreiben den Tag mit Punkt.
    const dayFirst = text.match(new RegExp(`\\b(\\d{1,2})(?:(?:er|e|st|nd|rd|th)?\\s+|\\.\\s*)${words}`));
    const monthFirst = text.match(new RegExp(`\\b${words}\\s+(\\d{1,2})(?:er|st|nd|rd|th)?\\b`));
    for (const match of [dayFirst, monthFirst]) {
      if (!match) continue;
      const dayOfMonth = Number(match[1]);
      if (dayOfMonth < 1 || dayOfMonth > 31) continue;
      let day = new Date(today.getFullYear(), month, dayOfMonth);
      if (day < today) day = new Date(today.getFullYear() + 1, month, dayOfMonth);
      if (day.getMonth() !== month) continue;   // 31 February and friends
      if (!earliest || match.index! < earliest.at) earliest = { at: match.index!, day, match };
    }
  }
  if (earliest) return found(earliest.day, earliest.match);

  /* „15.10.“ und „15.10.2026“: deutsch geschrieben, also immer Tag zuerst.
     Der zweite Punkt ist Pflicht, und danach darf keine weitere Ziffer kommen –
     sonst wäre „8.30“ eine Uhrzeit oder „1.2.3“ eine Versionsnummer. */
  const dotted = text.match(/\b(\d{1,2})\.(\d{1,2})\.(?:(\d{4}|\d{2})(?!\d)|(?!\d))/);
  if (dotted) {
    const dayOfMonth = Number(dotted[1]);
    const month = Number(dotted[2]) - 1;
    const year = dotted[3]
      ? Number(dotted[3].length === 2 ? `20${dotted[3]}` : dotted[3])
      : today.getFullYear();
    const day = new Date(year, month, dayOfMonth);
    if (day.getMonth() === month && day.getDate() === dayOfMonth) {
      const future = !dotted[3] && day < today ? new Date(year + 1, month, dayOfMonth) : day;
      return found(future, dotted);
    }
  }

  /* "12/03" and "12/03/2026". Day first, except when the Date format setting
     says month first: the order is a preference, not a fact about a language. */
  const numeric = text.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/);
  if (numeric) {
    const monthFirst = options.dateFormat === 'mdy';
    const dayOfMonth = Number(numeric[monthFirst ? 2 : 1]);
    const month = Number(numeric[monthFirst ? 1 : 2]) - 1;
    const year = numeric[3]
      ? Number(numeric[3].length === 2 ? `20${numeric[3]}` : numeric[3])
      : today.getFullYear();
    const day = new Date(year, month, dayOfMonth);
    if (day.getMonth() === month && day.getDate() === dayOfMonth) {
      const future = !numeric[3] && day < today
        ? new Date(year + 1, month, dayOfMonth)
        : day;
      return found(future, numeric);
    }
  }

  /* Nur eine Uhrzeit, ohne Tag: „Arzt 14 Uhr“, „Call um 9:30“, "call 2pm".
     Wie in Todoist heute – oder morgen, wenn die Uhrzeit heute schon vorbei
     ist. Nur eindeutige Uhrzeiten: „2h“ ist eher eine Dauer, und eine Tageszeit
     wie „abends“ allein ist zu oft einfach ein Wort im Namen. */
  const clock = readClockTime(text);
  if (clock) {
    const at = new Date(today.getFullYear(), today.getMonth(), today.getDate(), clock.hours, clock.minutes);
    const day = at.getTime() <= now.getTime() ? addDays(today, 1) : today;
    const pad = (n: number) => String(n).padStart(2, '0');
    return {
      date: `${toApiDate(day)}T${pad(clock.hours)}:${pad(clock.minutes)}:00`,
      matched: raw.slice(clock.start, clock.end),
      index: clock.start,
      hasTime: true,
    };
  }

  return null;
}

/** A clock time that cannot be anything else: „14 Uhr“, „um 9“, „9:30“, "2pm", « 9h30 ». */
function readClockTime(text: string): TimeReading | null {
  const patterns = [
    /\b(?:at\s+|à\s+|a\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i,
    /\b(?:um\s+)?(\d{1,2})(?:[:.](\d{2}))?\s*uhr\b/i,
    /\bum\s+(\d{1,2})(?:[:.](\d{2}))?(?![.:]?\d)/i,
    /\b(?:at\s+|à\s+|a\s+|um\s+)?(\d{1,2}):(\d{2})\b/i,
    /\b(?:à\s+|a\s+)?(\d{1,2})h(\d{2})\b/i,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (!match) continue;
    let hours = Number(match[1]);
    const minutes = Number(match[2] ?? 0);
    const half = match[3]?.toLowerCase();
    if (half) {
      if (hours < 1 || hours > 12) continue;
      hours = (hours % 12) + (half === 'pm' ? 12 : 0);
    }
    if (hours > 23 || minutes > 59) continue;
    return { hours, minutes, start: match.index!, end: match.index! + match[0].length };
  }
  return null;
}

/** Removes the phrase the reading came from, leaving a clean task name. */
export function stripReading(raw: string, reading: DateReading): string {
  const escaped = reading.matched.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return raw
    .replace(new RegExp(escaped, 'i'), ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}
