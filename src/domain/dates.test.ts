import { describe, expect, it } from 'vitest';
import type { Item } from './types';
import { dateTone, formatDayHeading, formatTimeAgo, msUntilNextDay, weekStartsOnOf } from './dates';

describe('msUntilNextDay (#146)', () => {
  it('counts to the next local midnight', () => {
    expect(msUntilNextDay(new Date(2026, 8, 28, 23, 59, 30))).toBe(30_000);
    expect(msUntilNextDay(new Date(2026, 8, 28, 0, 0, 0))).toBe(24 * 3600_000);
  });

  it('always lands on a midnight, whatever the hour it is asked at', () => {
    for (const hour of [0, 1, 6, 12, 18, 23]) {
      const now = new Date(2026, 9, 25, hour, 15);
      const then = new Date(now.getTime() + msUntilNextDay(now));
      expect([then.getHours(), then.getMinutes(), then.getSeconds()]).toEqual([0, 0, 0]);
      expect(then.getDate()).toBe(26);
    }
  });
});

describe('formatTimeAgo', () => {
  const now = new Date('2026-10-10T12:00:00Z');
  const ago = (ms: number) => new Date(now.getTime() - ms);

  it('says minutes, hours and days as a notification does, in both languages', () => {
    expect(formatTimeAgo(ago(10 * 60_000), 'en', now)).toBe('10 minutes ago');
    expect(formatTimeAgo(ago(10 * 3_600_000), 'en', now)).toBe('10 hours ago');
    expect(formatTimeAgo(ago(2 * 86_400_000), 'en', now)).toBe('2 days ago');
    expect(formatTimeAgo(ago(10 * 3_600_000), 'fr', now)).toBe('Il y a 10 heures');
  });

  it('says "just now" under a minute, and gives a plain date after a week', () => {
    expect(formatTimeAgo(ago(20_000), 'en', now)).toBe('Just now');
    expect(formatTimeAgo(ago(20_000), 'fr', now)).toBe('À l’instant');
    expect(formatTimeAgo(ago(9 * 86_400_000), 'en', now)).toMatch(/Oct|Sep/);
  });
});


describe('weekStartsOnOf (#3)', () => {
  it('reads Todoist\'s start_day, Monday when missing or invalid', () => {
    expect(weekStartsOnOf(7)).toBe(0);
    expect(weekStartsOnOf(1)).toBe(1);
    expect(weekStartsOnOf(6)).toBe(6);
    expect(weekStartsOnOf(undefined)).toBe(1);
    expect(weekStartsOnOf(0)).toBe(1);
    expect(weekStartsOnOf(9)).toBe(1);
  });
});

describe('dateTone (#218)', () => {
  const now = new Date(2026, 9, 12, 10, 0);
  const on = (day: number) => ({ due: { date: `2026-10-${String(day).padStart(2, '0')}` } }) as unknown as Item;

  it("follows Todoist: today, tomorrow, the next two to seven days, then none", () => {
    expect(dateTone(on(12), now)).toBe('today');
    expect(dateTone(on(13), now)).toBe('tomorrow');
    expect(dateTone(on(14), now)).toBe('week');
    expect(dateTone(on(19), now)).toBe('week');
    expect(dateTone(on(20), now)).toBe('later');
  });

  it('has nothing to say about a task with no date', () => {
    expect(dateTone({ due: null } as unknown as Item, now)).toBeNull();
  });
});

describe('formatDayHeading', () => {
  const now = new Date(2026, 9, 15, 18, 0);
  it('says Heute and Morgen, then the full date', () => {
    expect(formatDayHeading(new Date(2026, 9, 15), 'de', now)).toBe('Heute');
    expect(formatDayHeading(new Date(2026, 9, 16), 'de', now)).toBe('Morgen');
    expect(formatDayHeading(new Date(2026, 9, 17), 'de', now)).toBe('Samstag, 17. Oktober 2026');
    expect(formatDayHeading(new Date(2026, 9, 14), 'de', now)).toBe('Mittwoch, 14. Oktober 2026');
  });
});
