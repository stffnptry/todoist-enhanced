import { describe, expect, it } from 'vitest';
import { isListLabel, listDisplayName, listLabel, listOf, newListLabel, parseListLabel, setKnownAreas } from './lists';

describe('Listen über Labels', () => {
  it('baut das Label aus Bereich und Liste, ohne Umlaute und Groß-/Kleinschreibung', () => {
    expect(listLabel('Privat', 'Geplante Aufgaben')).toBe('privat_geplante_aufgaben');
    expect(listLabel('Arbeit', 'Wiederholend')).toBe('arbeit_wiederholend');
    expect(listLabel('Über Bereich', 'Änderung')).toBe('ueber_bereich_aenderung');
  });

  it('zerlegt nur Labels mit bekannter Liste', () => {
    expect(parseListLabel('privat_wiederholend')).toEqual({ area: 'privat', list: 'wiederholend' });
    expect(parseListLabel('Arbeit_Geplant')).toEqual({ area: 'arbeit', list: 'geplant' });
    expect(parseListLabel('privat_projekt')).toBeNull();
    expect(parseListLabel('privat')).toBeNull();
  });

  it('erkennt jedes Label mit einem bekannten Bereich, auch mit freiem Namen', () => {
    setKnownAreas(['Privat Team']);
    expect(parseListLabel('privat_team_urlaub')).toEqual({ area: 'privat_team', list: 'urlaub' });
    expect(isListLabel('privat_team_urlaub')).toBe(true);
    expect(isListLabel('privat_urlaub')).toBe(false);
    setKnownAreas([]);
  });

  it('blendet nur Listen-Labels aus, andere Tags bleiben', () => {
    expect(isListLabel('claude_eingang')).toBe(true);
    expect(isListLabel('est-30')).toBe(false);
    expect(isListLabel('einkauf')).toBe(false);
  });

  it('findet die Liste einer Aufgabe über den Bereich', () => {
    expect(listOf(['einkauf', 'privat_geplant'], ['Privat', 'Arbeit'])).toEqual({ area: 'privat', list: 'geplant' });
    expect(listOf(['arbeit_geplant'], ['Privat'])).toBeNull();
    expect(listOf([], ['Privat'])).toBeNull();
  });

  it('gibt Listen lesbare Namen', () => {
    expect(listDisplayName('wiederholend')).toBe('Wiederholende Aufgaben');
    expect(listDisplayName('projekte')).toBe('Projekte');
  });
});

describe('Neue Liste im Bereich', () => {
  it('gibt das Label für eine neue Liste, ohne Namen mit Sonderzeichen', () => {
    expect(newListLabel('Privat', 'Einkauf')).toBe('privat_einkauf');
    expect(newListLabel('Privat', '!!!')).toBeNull();
    expect(newListLabel('', 'Einkauf')).toBeNull();
  });
});
