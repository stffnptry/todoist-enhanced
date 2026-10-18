import { describe, expect, it } from 'vitest';
import { areaTitle, compareLists, isListLabel, listAreas, listDisplayName, listLabel, listOf, newListLabel, parseListLabel, readListMeta, setKnownAreas, splitListName } from './lists';

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

describe('Bereiche und Listen in der Seitenleiste', () => {
  it('liest Bereich und Liste aus Projekt- und Label-Namen', () => {
    expect(splitListName('Claude_Eingang')).toEqual({ area: 'claude', list: 'eingang' });
    expect(splitListName('arbeit_geplant')).toEqual({ area: 'arbeit', list: 'geplant' });
    expect(splitListName('Einkaufsliste')).toBeNull();
    expect(areaTitle('privat')).toBe('Privat');
  });
});

describe('selbst angelegte Listen', () => {
  it('liest Listentyp, Symbol und Namen und verwirft Unbrauchbares', () => {
    expect(readListMeta({
      privat_einkauf: { kind: 'project', icon: 'cart', name: ' Einkauf ' },
      privat_x: { kind: 'odd', icon: '<b>', name: 'X' },
      privat_leer: { kind: 'list', name: '' },
      privat_kaputt: 'nein',
    })).toEqual({
      privat_einkauf: { kind: 'project', icon: 'cart', name: 'Einkauf' },
      privat_x: { kind: 'list', icon: null, name: 'X' },
    });
    expect(readListMeta(undefined)).toEqual({});
  });

  it('findet die Bereiche aus den Listen-Namen', () => {
    expect(listAreas(['privat_geplant', 'Claude_Eingang', 'est-30', 'privat_wiederholend']).sort())
      .toEqual(['claude', 'privat']);
  });

  it('erkennt eine eigene Liste, sobald ihr Bereich bekannt ist', () => {
    setKnownAreas(listAreas(['privat_geplant']));
    expect(parseListLabel('privat_urlaub_planen')).toEqual({ area: 'privat', list: 'urlaub_planen' });
    setKnownAreas([]);
  });

  it('sortiert die festen Listen zuerst, dann nach Name', () => {
    const rows = [
      { list: 'zebra', name: 'Zebra' },
      { list: 'geplant', name: 'Geplante Aufgaben' },
      { list: 'einkauf', name: 'Einkauf' },
      { list: 'wiederholend', name: 'Wiederholende Aufgaben' },
    ];
    expect([...rows].sort(compareLists).map((r) => r.list)).toEqual(['wiederholend', 'geplant', 'einkauf', 'zebra']);
  });
});
