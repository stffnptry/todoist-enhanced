import { describe, expect, it } from 'vitest';
import { readNaturalDate } from './nlp';

/* A Monday, so nothing below depends on which day the tests happen to run. */
const now = new Date(2026, 8, 28);

const read = (text: string, options?: Parameters<typeof readNaturalDate>[2]) =>
  readNaturalDate(text, now, options);

describe('a month is read from its own words, not its first three letters (#123)', () => {
  it('reads « 14 juillet » as July, not June', () => {
    expect(read('Fête 14 juillet')?.date).toBe('2027-07-14');
  });

  it('reads an ordinal day: « 1er juillet », "July 1st"', () => {
    expect(read('Réunion 1er juillet')?.date).toBe('2027-07-01');
    expect(read('Party July 1st')?.date).toBe('2027-07-01');
  });

  it('reads the abbreviations both languages use', () => {
    expect(read('sept 10')?.date).toBe('2027-09-10');
    expect(read('10 sept.')?.matched).toBe('10 sept.');
    expect(read('14 juil')?.date).toBe('2027-07-14');
    expect(read('Call 3 mars')?.date).toBe('2027-03-03');
  });

  it.each([
    'Visiter 2 maisons',
    'Acheter 3 marrons',
    'Buy 2 apricots',
    'Review 2 decks',
  ])('reads nothing in "%s"', (text) => {
    expect(read(text)).toBeNull();
  });

  it('skips a day the month does not have', () => {
    expect(read('31 février')).toBeNull();
  });

  it('keeps the month that starts first when a sentence holds two', () => {
    expect(read('du 3 mars au 9 mai')?.matched).toBe('3 mars');
  });
});

describe('a numeric date follows the Date format setting (#123)', () => {
  it('reads 12/03 day first by default', () => {
    expect(read('Call 12/03')?.date).toBe('2027-03-12');
  });

  it('reads 12/03 month first when the setting says so', () => {
    expect(read('Call 12/03', { dateFormat: 'mdy' })?.date).toBe('2026-12-03');
  });

  it.each(['dmy', 'ymd', 'numeric'] as const)('reads 12/03 day first for %s', (dateFormat) => {
    expect(read('Call 12/03', { dateFormat })?.date).toBe('2027-03-12');
  });

  it('reads a year when there is one', () => {
    expect(read('12/03/2027')?.date).toBe('2027-03-12');
  });
});

describe('what already worked keeps working', () => {
  it('reads the named days', () => {
    expect(read('demain')?.date).toBe('2026-09-29');
    expect(read('lundi')?.date).toBe('2026-10-05');
    expect(read('next week')?.date).toBe('2026-10-05');
    expect(read('dans 2 semaines')?.date).toBe('2026-10-12');
  });

  it('reads a day with a time', () => {
    expect(read('tomorrow at 9h')?.date).toBe('2026-09-29T09:00:00');
  });
});


describe('relative calendar months and singular words', () => {
  it.each(['dans un mois', 'dans 1 mois', 'in a month', 'in one month'])('reads %s and keeps the exact matched span', (phrase) => {
    expect(read(`Faire ceci ${phrase}`)).toMatchObject({ date: '2026-10-28', matched: phrase, index: 11, hasTime: false });
  });
  it('reads several months and an attached time', () => {
    expect(read('dans 2 mois à 9h')?.date).toBe('2026-11-28T09:00:00');
    expect(read('dans une semaine')?.date).toBe('2026-10-05');
    expect(read('in a day')?.date).toBe('2026-09-29');
  });
  it('clamps the date at the end of a short month, including leap years', () => {
    expect(readNaturalDate('dans un mois', new Date(2026, 0, 31))?.date).toBe('2026-02-28');
    expect(readNaturalDate('dans un mois', new Date(2028, 0, 31))?.date).toBe('2028-02-29');
  });
  it('does not mistake nouns or incomplete phrases for offsets', () => {
    expect(read('dans une maison')).toBeNull();
    expect(read('dans un')).toBeNull();
  });
});

describe('deutsche Datumsangaben (Schnelleingabe)', () => {
  // now = Montag, 28.09.2026
  it.each([
    ['heute', '2026-09-28'],
    ['morgen', '2026-09-29'],
    ['übermorgen', '2026-09-30'],
    ['nächste Woche', '2026-10-05'],
    ['Montag', '2026-10-05'],
    ['Freitag', '2026-10-02'],
    ['Sonnabend', '2026-10-03'],
    ['in 3 Tagen', '2026-10-01'],
    ['in einer Woche', '2026-10-05'],
    ['in zwei Wochen', '2026-10-12'],
    ['in einem Monat', '2026-10-28'],
    ['15. Oktober', '2026-10-15'],
    ['1. März', '2027-03-01'],
    ['15.10.', '2026-10-15'],
    ['3.1.2027', '2027-01-03'],
    ['15.10.26', '2026-10-15'],
  ])('liest „%s“', (phrase, date) => {
    expect(read(`Steuer machen ${phrase}`)?.date).toBe(date);
  });

  it('nimmt die Uhrzeit mit: „morgen 8:30“, „morgen um 9“, „Freitag 14 Uhr“', () => {
    expect(read('Arzt morgen 8:30')).toMatchObject({ date: '2026-09-29T08:30:00', matched: 'morgen 8:30' });
    expect(read('Arzt morgen um 9')).toMatchObject({ date: '2026-09-29T09:00:00', matched: 'morgen um 9' });
    expect(read('Arzt Freitag 14 Uhr')).toMatchObject({ date: '2026-10-02T14:00:00', matched: 'Freitag 14 Uhr' });
    expect(read('Arzt am Freitag um 8.15 Uhr')).toMatchObject({ date: '2026-10-02T08:15:00', matched: 'am Freitag um 8.15 Uhr' });
  });

  it('versteht Tageszeiten: „heute Abend“, „morgen früh“, „heute Morgen“', () => {
    expect(read('Anrufen heute Abend')?.date).toBe('2026-09-28T19:00:00');
    expect(read('Anrufen morgen früh')?.date).toBe('2026-09-29T09:00:00');
    expect(read('Anrufen heute Morgen')?.date).toBe('2026-09-28T09:00:00');
    expect(read('Anrufen morgen Nachmittag')?.date).toBe('2026-09-29T14:00:00');
  });

  it('nimmt Füllwörter mit, damit sie nicht im Namen bleiben', () => {
    expect(read('Bericht bis Freitag')?.matched).toBe('bis Freitag');
    expect(read('Bericht nächsten Montag')?.matched).toBe('nächsten Montag');
    expect(read('Bericht bis morgen')?.matched).toBe('bis morgen');
  });

  it.each([
    'Joggen jeden Montag',
    'Joggen jeden Morgen',
    'Guten Morgen sagen',
    'Release 1.2.3 testen',
  ])('liest nichts in „%s“', (text) => {
    expect(read(text)?.date ?? null).toBeNull();
  });

  it('englische Angaben gehen weiter', () => {
    expect(read('tomorrow 08:30')?.date).toBe('2026-09-29T08:30:00');
    expect(read('monday')?.date).toBe('2026-10-05');
    expect(read('in 3 days')?.date).toBe('2026-10-01');
  });
});

describe('„in 30 Minuten“: ab jetzt gerechnet', () => {
  const at = new Date(2026, 8, 28, 23, 50);
  const readAt = (text: string) => readNaturalDate(text, at);
  it.each([
    ['in 30 Minuten', '2026-09-29T00:20:00'],
    ['in 5 min', '2026-09-28T23:55:00'],
    ['in 2 Stunden', '2026-09-29T01:50:00'],
    ['in einer Stunde', '2026-09-29T00:50:00'],
    ['in einer halben Stunde', '2026-09-29T00:20:00'],
    ['in anderthalb Stunden', '2026-09-29T01:20:00'],
    ['in 45 minutes', '2026-09-29T00:35:00'],
    ['in an hour', '2026-09-29T00:50:00'],
    ['dans 2 heures', '2026-09-29T01:50:00'],
  ])('liest „%s“', (phrase, date) => {
    expect(readAt(`Wäsche ${phrase}`)).toMatchObject({ date, matched: phrase, index: 7, hasTime: true });
  });
});

describe('nur eine Uhrzeit: heute, oder morgen, wenn sie schon vorbei ist', () => {
  const at = new Date(2026, 8, 28, 10, 0);
  const readAt = (text: string) => readNaturalDate(text, at);
  it.each([
    ['Arzt 14 Uhr', '2026-09-28T14:00:00', '14 Uhr'],
    ['Arzt um 14:30', '2026-09-28T14:30:00', 'um 14:30'],
    ['Arzt um 15', '2026-09-28T15:00:00', 'um 15'],
    ['Arzt 8.30 Uhr', '2026-09-29T08:30:00', '8.30 Uhr'],
    ['Arzt 16:45', '2026-09-28T16:45:00', '16:45'],
    ['Kaffee um 8.30.', '2026-09-29T08:30:00', 'um 8.30'],
    ['Call 2pm', '2026-09-28T14:00:00', '2pm'],
    ['Appel à 9h30', '2026-09-29T09:30:00', 'à 9h30'],
  ])('liest „%s“', (text, date, matched) => {
    expect(readAt(text)).toMatchObject({ date, matched, hasTime: true });
  });
  it('ein Tag mit Uhrzeit geht vor', () => {
    expect(readAt('Arzt morgen 14 Uhr')?.date).toBe('2026-09-29T14:00:00');
  });
  it('liest keine Dauer und keine Tageszeit allein als Uhrzeit', () => {
    expect(readAt('Lernen 2h')).toBeNull();
    expect(readAt('Abendessen kochen')).toBeNull();
    expect(readAt('Kapitel 3 lesen')).toBeNull();
  });
});
