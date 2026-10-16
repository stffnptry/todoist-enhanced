import { describe, expect, it } from 'vitest';
import { dateSuggestions } from './dateWords';

const now = new Date(2026, 8, 28);

describe('Vorschläge beim Tippen', () => {
  it('schlägt auf Deutsch zuerst deutsche Wörter vor', () => {
    expect(dateSuggestions('mo', 'de', now)[0]).toEqual({ word: 'morgen', date: '2026-09-29' });
    expect(dateSuggestions('üb', 'de', now)[0]).toEqual({ word: 'übermorgen', date: '2026-09-30' });
    expect(dateSuggestions('fr', 'de', now)[0]).toEqual({ word: 'Freitag', date: '2026-10-02' });
  });

  it('kennt die anderen Sprachen weiterhin', () => {
    expect(dateSuggestions('tom', 'de', now)[0]).toEqual({ word: 'tomorrow', date: '2026-09-29' });
    expect(dateSuggestions('tom', 'en', now)[0]).toEqual({ word: 'tomorrow', date: '2026-09-29' });
  });
});
