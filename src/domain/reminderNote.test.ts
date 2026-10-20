import { describe, expect, it } from 'vitest';
import {
  anchorReminder, readReminderNotes, reminderLine, reminderMoment, withReminderNotes,
} from './reminderNote';
import { upcomingReminders } from './reminders';
import { emptySnapshot, type Item } from './types';

describe('Erinnerungszeilen in der Beschreibung', () => {
  it('schreibt und liest alle drei Arten', () => {
    const notes = [
      { kind: 'time' as const, time: '14:00' },
      { kind: 'at' as const, date: '2026-10-21', time: '09:30' },
      { kind: 'before' as const, minutes: 30 },
      { kind: 'before' as const, minutes: 120 },
    ];
    const text = withReminderNotes('Notizen', notes);
    expect(text).toBe('Notizen\n\nErinnerung: 14:00\nErinnerung: 21.10.2026 09:30\nErinnerung: 30 Min. vorher\nErinnerung: 2 Std. vorher');
    expect(readReminderNotes(text)).toEqual(notes);
  });

  it('liest auch von Hand geschriebene Zeilen und übergeht anderes', () => {
    expect(readReminderNotes('Erinnerung: 9 Uhr\nerinnerung: 45 min\nErinnerung: irgendwann\nErinnerung: 25:00'))
      .toEqual([{ kind: 'time', time: '09:00' }, { kind: 'before', minutes: 45 }]);
    expect(reminderLine({ kind: 'before', minutes: 30 })).toBe('Erinnerung: 30 Min. vorher');
  });

  it('legt eine Uhrzeit ohne Datum auf heute oder morgen fest', () => {
    const morning = new Date(2026, 9, 20, 8, 0);
    expect(anchorReminder({ kind: 'time', time: '14:00' }, false, morning))
      .toEqual({ kind: 'at', date: '2026-10-20', time: '14:00' });
    expect(anchorReminder({ kind: 'time', time: '07:00' }, false, morning))
      .toEqual({ kind: 'at', date: '2026-10-21', time: '07:00' });
    expect(anchorReminder({ kind: 'time', time: '07:00' }, true, morning)).toEqual({ kind: 'time', time: '07:00' });
  });

  it('rechnet den Zeitpunkt vom Fälligkeitstag aus', () => {
    const due = { date: '2026-10-22T10:00:00', is_recurring: false, string: '', timezone: null, lang: 'de' };
    expect(reminderMoment({ kind: 'time', time: '08:15' }, { due: { ...due, date: '2026-10-22' } }))
      .toBe(new Date(2026, 9, 22, 8, 15).getTime());
    expect(reminderMoment({ kind: 'before', minutes: 30 }, { due }))
      .toBe(new Date(2026, 9, 22, 9, 30).getTime());
    expect(reminderMoment({ kind: 'before', minutes: 30 }, { due: { ...due, date: '2026-10-22' } })).toBeNull();
    expect(reminderMoment({ kind: 'time', time: '08:15' }, { due: null })).toBeNull();
  });

  it('wird zur Mitteilung der Mac-App, statt der zur Fälligkeit', () => {
    const item = {
      id: 'a', content: 'Arzt', description: 'Erinnerung: 30 Min. vorher', checked: false, is_deleted: false,
      due: { date: '2026-10-22T10:00:00', is_recurring: false, string: '', timezone: null, lang: 'de' },
    } as unknown as Item;
    const now = new Date(2026, 9, 22, 9, 0).getTime();
    const list = upcomingReminders({ ...emptySnapshot(), items: { a: item } }, now, 6 * 3600_000);
    expect(list.map((r) => new Date(r.at).getHours() * 60 + new Date(r.at).getMinutes())).toEqual([9 * 60 + 30]);
  });
});
