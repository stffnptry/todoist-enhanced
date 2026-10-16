/**
 * Deutsche Wiederholungen beim Eintippen: „jeden Montag“, „täglich“,
 * „alle 3 Tage um 9“.
 *
 * Gelesen wird Deutsch, an Todoist geschickt wird die englische Form, die
 * Todoist dokumentiert („every mon at 09:00“). So hängt nichts davon ab, wie
 * gut Todoists eigener deutscher Parser eine bestimmte Formulierung versteht,
 * und die übrige App, die Regeln auf Englisch schreibt und liest (Datumsfeld,
 * Uhrzeit wiederkehrender Aufgaben), bleibt unverändert.
 *
 * Wie beim englischen und französischen Leser gilt: lieber nichts lesen als
 * etwas Falsches. Was hier nicht passt, bleibt Text im Aufgabennamen.
 */

import type { RecurrenceReading } from './recurrence';

const DAYS: Array<[string, string]> = [
  ['sonntag|sonntags|so', 'sun'],
  ['montag|montags|mo', 'mon'],
  ['dienstag|dienstags|di', 'tue'],
  ['mittwoch|mittwochs|mi', 'wed'],
  ['donnerstag|donnerstags|do', 'thu'],
  ['freitag|freitags|fr', 'fri'],
  ['samstag|samstags|sonnabend|sonnabends|sa', 'sat'],
];

const MONTHS: Array<[string, string]> = [
  ['januar|jan', 'jan'], ['februar|feb', 'feb'], ['marz|maerz|mrz', 'mar'],
  ['april|apr', 'apr'], ['mai', 'may'], ['juni|jun', 'jun'], ['juli|jul', 'jul'],
  ['august|aug', 'aug'], ['september|sept|sep', 'sep'], ['oktober|okt', 'oct'],
  ['november|nov', 'nov'], ['dezember|dez', 'dec'],
];

/** Einheiten, Einzahl und Mehrzahl, jeweils mit der englischen Form. */
const UNITS: Array<[string, string, string]> = [
  ['stunden?', 'hour', 'hours'],
  ['tage?', 'day', 'days'],
  ['wochen?', 'week', 'weeks'],
  ['monate?', 'month', 'months'],
  ['quartale?', 'quarter', 'quarters'],
  ['jahre?', 'year', 'years'],
];

const SHORTHAND: Array<[string, string]> = [
  ['stundlich', 'every hour'],
  ['taglich', 'every day'],
  ['werktags|werktaglich', 'every workday'],
  ['wochentlich', 'every week'],
  ['monatlich', 'every month'],
  ['vierteljahrlich|quartalsweise', 'every quarter'],
  ['jahrlich', 'every year'],
];

const POSITIONS: Record<string, string> = {
  ersten: '1st', dritten: '3rd', vierten: '4th', letzten: 'last',
};

const CLOCK_WORDS: Record<string, string> = {
  morgens: 'morning', vormittags: 'morning', mittags: 'noon',
  nachmittags: 'afternoon', abends: 'evening', nachts: 'night',
};

const fold = (text: string): string =>
  text.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

const dayAlt = DAYS.map(([de]) => de).join('|');
const day = `(?:${dayAlt})\\b`;
const dayFull = `(?:${DAYS.map(([de]) => de.split('|').filter((w) => w.length > 2).join('|')).join('|')})\\b`;
const month = `(?:${MONTHS.map(([de]) => de).join('|')})\\b\\.?`;
const unitAlt = `(?:${UNITS.map(([de]) => de).join('|')})\\b`;
const and = '\\s*(?:,|und|&)\\s*';
const every = '(?:jeden|jede|jedes|alle)(!)?';

/* Die Uhrzeit am Ende: „um 9“, „um 9:30 Uhr“, „9 Uhr“, „14:00“, „morgens“. */
const clock = '(?:(?:um\\s+)?(\\d{1,2})(?:[:.](\\d{2}))?\\s*uhr|um\\s+(\\d{1,2})(?:[:.](\\d{2}))?|(\\d{1,2}):(\\d{2}))';
const time = `(?:\\s+(?:${clock}|(${Object.keys(CLOCK_WORDS).join('|')})))?`;
/* Eine Dauer am Ende: „für 3 Wochen“. Start- und Enddaten („ab 1.11.“) liest
   dieser Leser bewusst nicht: wie Todoist „1/11“ deutet, hängt von dessen
   Datumseinstellung ab, und ein vertauschter Monat wäre eine stille Panne. */
const span = `(?:\\s+fur\\s+(\\d{1,3})\\s+(${unitAlt}))?`;

const englishDay = (word: string): string | null => {
  for (const [de, en] of DAYS) {
    if (new RegExp(`^(?:${de})$`).test(word)) return en;
  }
  return null;
};

const englishMonth = (word: string): string | null => {
  const bare = word.replace(/\.$/, '');
  for (const [de, en] of MONTHS) {
    if (new RegExp(`^(?:${de})$`).test(bare)) return en;
  }
  return null;
};

const englishUnit = (word: string, plural: boolean): string | null => {
  for (const [de, one, many] of UNITS) {
    if (new RegExp(`^(?:${de})$`).test(word)) return plural ? many : one;
  }
  return null;
};

const daysIn = (list: string): string[] | null => {
  const out: string[] = [];
  for (const part of list.split(/\s*(?:,|und|&)\s*/)) {
    const en = englishDay(part.trim());
    if (!en) return null;
    out.push(en);
  }
  return out;
};

interface Form {
  pattern: string;
  /** Baut aus dem Treffer den englischen Kern, ohne „every“. Null = verworfen. */
  build: (m: RegExpMatchArray) => string | null;
  /** Ob das Wort für „jeden“ selbst Teil des Musters ist (sonst: Kurzform). */
  opener: boolean;
}

/* Längste Formen zuerst: „jeden ersten Montag“ beginnt wie „jeden …“, und
   eine kürzere Form, die zuerst passt, würde die Regel still abschneiden. */
const FORMS: Form[] = [
  /* jeden zweiten Montag im Monat. Ohne „im Monat“ meint „jeden zweiten
     Montag“ jede andere Woche – das liest die Form „jeden zweiten …“ weiter
     unten. */
  {
    pattern: `${every}\\s+(zweiten|2\\.)\\s+(${dayFull})\\s+(?:im|des|jeden)\\s+monats?`,
    build: (m) => {
      const d = englishDay(m[3]);
      return d ? `2nd ${d}` : null;
    },
    opener: true,
  },
  // jeden ersten / letzten Montag (im Monat)
  {
    pattern: `${every}\\s+(ersten|dritten|vierten|letzten|[134]\\.)\\s+(${dayFull})(?:\\s+(?:im|des|jeden)\\s+monats?)?`,
    build: (m) => {
      const rank = POSITIONS[m[2]] ?? ({ '1.': '1st', '3.': '3rd', '4.': '4th' } as Record<string, string>)[m[2]];
      const d = englishDay(m[3]);
      return rank && d ? `${rank} ${d}` : null;
    },
    opener: true,
  },
  // jeden letzten Tag (im Monat)
  {
    pattern: `${every}\\s+letzten\\s+tag(?:\\s+(?:im|des)\\s+monats?)?`,
    build: () => 'last day',
    opener: true,
  },
  // jeden 15. Januar
  {
    pattern: `${every}\\s+(\\d{1,2})\\.\\s*(${month})`,
    build: (m) => {
      const mo = englishMonth(m[3]);
      const n = Number(m[2]);
      return mo && n >= 1 && n <= 31 ? `${mo} ${n}` : null;
    },
    opener: true,
  },
  // jeden 1. und 15. (im Monat)
  {
    pattern: `${every}\\s+(\\d{1,2}\\.(?:${and}\\d{1,2}\\.)*)(?:\\s+(?:im|des|jeden)\\s+monats?)?(?!\\s*\\d)`,
    build: (m) => {
      const days = m[2].split(/\s*(?:,|und|&)\s*/).map((p) => Number(p.replace('.', '')));
      if (days.some((n) => !(n >= 1 && n <= 31))) return null;
      return days.join(', ');
    },
    opener: true,
  },
  // alle 2 Wochen am Montag, alle 2 Wochen montags und donnerstags
  {
    pattern: `${every}\\s+(\\d{1,3})\\s+wochen\\s+(?:am\\s+)?((?:${day})(?:${and}(?:${day}))*)`,
    build: (m) => {
      const days = daysIn(m[3]);
      return days ? `${m[2]} weeks ${days.join(', ')}` : null;
    },
    opener: true,
  },
  // alle 3 Werktage
  {
    pattern: `${every}\\s+(\\d{1,3})\\s+werktage\\b`,
    build: (m) => `${m[2]} workdays`,
    opener: true,
  },
  // jeden Montag und Donnerstag
  {
    pattern: `${every}\\s+((?:${dayFull})(?:${and}(?:${dayFull}))*)`,
    build: (m) => {
      const days = daysIn(m[2]);
      return days ? days.join(', ') : null;
    },
    opener: true,
  },
  // alle 3 Tage, alle 2 Wochen
  {
    pattern: `${every}\\s+(\\d{1,3})\\s+(${unitAlt})`,
    build: (m) => {
      const n = Number(m[2]);
      if (n < 1) return null;
      const unit = englishUnit(m[3], n !== 1);
      return unit ? `${n} ${unit}` : null;
    },
    opener: true,
  },
  // jeden zweiten Tag, jede zweite Woche, jeden zweiten Freitag
  {
    pattern: `${every}\\s+(?:zweiten|zweite|zweites)\\s+(${unitAlt}|${dayFull})`,
    build: (m) => {
      const target = englishUnit(m[2], false) ?? englishDay(m[2]);
      return target ? `other ${target}` : null;
    },
    opener: true,
  },
  // jeden Werktag, jedes Wochenende
  {
    pattern: `${every}\\s+(werktag|arbeitstag|wochenende)\\b`,
    build: (m) => (m[2] === 'wochenende' ? 'weekend' : 'workday'),
    opener: true,
  },
  /* jeden Morgen, jeden Abend: jeden Tag zu dieser Tageszeit. Ohne
     nachfolgende Uhrzeit – „jeden Morgen um 7“ ist jeden Tag um 7. */
  {
    pattern: `(?:jeden)(!)?\\s+(morgen|vormittag|mittag|nachmittag|abend)\\b(?=\\s+(?:um\\s+)?\\d)`,
    build: () => 'day',
    opener: true,
  },
  {
    pattern: `(?:jeden)(!)?\\s+(morgen|vormittag|mittag|nachmittag|abend)\\b`,
    build: (m) => `day at ${CLOCK_WORDS[`${m[2]}s`]}`,
    opener: true,
  },
  // jeden Tag, jede Woche, jedes Jahr
  {
    pattern: `(?:jeden|jede|jedes)(!)?\\s+(${unitAlt})`,
    build: (m) => englishUnit(m[2], false),
    opener: true,
  },
  // montags, montags und donnerstags (ohne „jeden“)
  {
    pattern: `((?:montags|dienstags|mittwochs|donnerstags|freitags|samstags|sonnabends|sonntags)\\b(?:${and}(?:montags|dienstags|mittwochs|donnerstags|freitags|samstags|sonnabends|sonntags)\\b)*)`,
    build: (m) => {
      const days = daysIn(m[1]);
      return days ? days.join(', ') : null;
    },
    opener: false,
  },
  // täglich, wöchentlich, werktags
  {
    pattern: `(${SHORTHAND.map(([de]) => de).join('|')})\\b`,
    build: (m) => {
      const hit = SHORTHAND.find(([de]) => new RegExp(`^(?:${de})$`).test(m[1]));
      return hit ? hit[1].replace(/^every /, '') : null;
    },
    opener: false,
  },
];

const pad = (n: string | undefined) => String(Number(n ?? 0)).padStart(2, '0');

/** Findet eine deutsche Wiederholung in `raw` und gibt sie englisch zurück. */
export function readGermanRecurrence(raw: string): RecurrenceReading | null {
  const text = fold(raw);

  for (const form of FORMS) {
    const re = new RegExp(`\\b${form.pattern}${time}${span}`);
    const m = text.match(re);
    if (!m) continue;
    const core = form.build(m);
    if (!core) continue;

    /* Die Gruppen von Uhrzeit und Dauer stehen hinter denen der Form. */
    const groups = m.slice(1);
    const tail = groups.slice(groups.length - 9);
    const [uh, um, ah, am, ch, cm, word, spanN, spanUnit] = tail;
    let at = '';
    const hours = uh ?? ah ?? ch;
    const minutes = uh ? um : ah ? am : cm;
    if (hours !== undefined) {
      if (Number(hours) > 23 || Number(minutes ?? 0) > 59) continue;
      at = ` at ${pad(hours)}:${pad(minutes)}`;
    } else if (word) {
      at = ` at ${CLOCK_WORDS[word]}`;
    }
    let bound = '';
    if (spanN && spanUnit) {
      const unit = englishUnit(spanUnit, Number(spanN) !== 1);
      if (!unit) continue;
      bound = ` for ${spanN} ${unit}`;
    }

    const fromCompletion = form.opener && groups[0] === '!';
    const matched = raw.slice(m.index!, m.index! + m[0].length).trim();
    return {
      matched,
      index: m.index!,
      string: `every${fromCompletion ? '!' : ''} ${core}${at}${bound}`,
      lang: 'en',
      fromCompletion,
    };
  }
  return null;
}
