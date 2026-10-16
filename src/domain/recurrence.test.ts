import { describe, expect, it } from 'vitest';
import { dueForDate, readRecurrence } from './recurrence';

describe('readRecurrence', () => {
  it('finds an English rule inside a title', () => {
    expect(readRecurrence('Water plants every monday')).toEqual({
      matched: 'every monday', index: 13, string: 'every monday', lang: 'en', fromCompletion: false,
    });
  });

  it('finds a French rule', () => {
    expect(readRecurrence('Arroser tous les lundis')).toMatchObject({
      string: 'tous les lundis', lang: 'fr',
    });
  });

  it('reads every! as counted from completion', () => {
    expect(readRecurrence('every! 2 weeks')).toMatchObject({ fromCompletion: true });
  });

  it.each(['every day at 9am', 'every other week'])('reads %j', (text) => {
    expect(readRecurrence(text)?.string).toBe(text);
  });

  it('leaves ordinary text alone', () => {
    expect(readRecurrence('buy milk')).toBeNull();
  });

  it('refuses rules that need a holiday calendar', () => {
    expect(readRecurrence('every workday after holidays')).toBeNull();
  });
});

describe('readRecurrence with a time and a bound', () => {
  it('keeps the end that follows a time', () => {
    expect(readRecurrence('every mon at 9:15 ending 2026-12-31')?.string).toBe('every mon at 9:15 ending 2026-12-31');
    expect(readRecurrence('tous les lun à 9h jusqu’au 2026-12-31')?.string).toBe('tous les lun à 9h jusqu’au 2026-12-31');
    expect(readRecurrence('every day at 9 am until dec 31')?.string).toBe('every day at 9 am until dec 31');
  });
});

describe('dueForDate dropping the time', () => {
  it('keeps the day and takes the time off when asked', () => {
    const existing = { date: '2026-10-12T09:15:00', timezone: null, string: '2026-10-12T09:15:00', lang: 'en', is_recurring: false };
    expect(dueForDate(existing, '2026-10-12').date).toBe('2026-10-12T09:15:00');
    expect(dueForDate(existing, '2026-10-12', 'en', { dropTime: true })).toMatchObject({
      date: '2026-10-12', string: '2026-10-12', is_recurring: false,
    });
  });
});

describe('dueForDate', () => {
  it('moves one occurrence without ending the series', () => {
    const rule = {
      date: '2026-09-21', timezone: null, string: 'every monday', lang: 'en', is_recurring: true,
    };
    expect(dueForDate(rule, '2026-09-30')).toEqual({ ...rule, date: '2026-09-30' });
  });

  it('writes a plain date for a task that does not repeat', () => {
    expect(dueForDate(null, '2026-09-30')).toEqual({
      date: '2026-09-30', timezone: null, string: '2026-09-30', lang: 'en', is_recurring: false,
    });
  });
});

describe('deutsche Wiederholungen werden als englische Regel an Todoist gegeben', () => {
  it.each([
    ['täglich', 'every day'],
    ['wöchentlich', 'every week'],
    ['werktags', 'every workday'],
    ['jeden Tag', 'every day'],
    ['jede Woche', 'every week'],
    ['jedes Jahr', 'every year'],
    ['jeden Werktag', 'every workday'],
    ['jedes Wochenende', 'every weekend'],
    ['jeden Montag', 'every mon'],
    ['jeden Montag und Donnerstag', 'every mon, thu'],
    ['montags', 'every mon'],
    ['dienstags und freitags', 'every tue, fri'],
    ['alle 3 Tage', 'every 3 days'],
    ['alle 2 Wochen', 'every 2 weeks'],
    ['alle 6 Monate', 'every 6 months'],
    ['alle 3 Werktage', 'every 3 workdays'],
    ['alle 2 Wochen am Montag', 'every 2 weeks mon'],
    ['jeden zweiten Tag', 'every other day'],
    ['jeden zweiten Freitag', 'every other fri'],
    ['jeden zweiten Montag im Monat', 'every 2nd mon'],
    ['jeden ersten Montag', 'every 1st mon'],
    ['jeden letzten Freitag im Monat', 'every last fri'],
    ['jeden letzten Tag im Monat', 'every last day'],
    ['jeden 15.', 'every 15'],
    ['jeden 1. und 15.', 'every 1, 15'],
    ['jeden 24. Dezember', 'every dec 24'],
    ['jeden Montag um 9', 'every mon at 09:00'],
    ['täglich um 7:30 Uhr', 'every day at 07:30'],
    ['jeden Tag 18 Uhr', 'every day at 18:00'],
    ['jeden Abend', 'every day at evening'],
    ['jeden Morgen um 7', 'every day at 07:00'],
    ['werktags morgens', 'every workday at morning'],
    ['jede Woche für 3 Wochen', 'every week for 3 weeks'],
    ['jeden! Tag', 'every! day'],
    ['alle! 3 Tage', 'every! 3 days'],
  ])('liest „%s“', (phrase, string) => {
    const reading = readRecurrence(`Sport ${phrase}`);
    if (string === null) {
      expect(reading).toBeNull();
      return;
    }
    expect(reading).toMatchObject({ string, lang: 'en', matched: phrase, index: 6 });
  });

  it('lässt normalen Text und Feiertage in Ruhe', () => {
    expect(readRecurrence('Alle Unterlagen sortieren')).toBeNull();
    expect(readRecurrence('jeden Feiertag')).toBeNull();
  });

  it('englische und französische Regeln bleiben, wie sie waren', () => {
    expect(readRecurrence('Gym every monday')).toMatchObject({ string: 'every monday', lang: 'en' });
    expect(readRecurrence('Sport tous les lundis')).toMatchObject({ lang: 'fr' });
  });
});
