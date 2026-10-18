import { describe, expect, it } from 'vitest';
import { areaKey, areaOf, chosenAreas, inAreas, quickAreas, toggleArea } from './projectQuick';
import { emptySnapshot, type Project, type Snapshot } from './types';
import { item } from '@/test/items';

const project = (id: string, name: string, extra: Partial<Project> = {}): Project => ({
  id, name, color: 'grey', parent_id: null, child_order: 0,
  is_archived: false, is_deleted: false, is_favorite: false, ...extra,
});
const snapshot: Snapshot = {
  ...emptySnapshot(),
  projects: {
    inbox: project('inbox', 'Inbox', { inbox_project: true }),
    pw: project('pw', 'privat_wiederholend'),
    pg: project('pg', 'Privat_Geplant'),
    ag: project('ag', 'arbeit_geplant'),
    ce: project('ce', 'Claude_Eingang'),
    ordner: project('ordner', 'Arbeit', { is_folder: true }),
    kunde: project('kunde', 'Kunde A', { parent_id: 'ordner' }),
  },
};

describe('Bereichs-Schnellfilter', () => {
  it('liest den Bereich aus dem Projektnamen, einem Ordner oder einem Listen-Label', () => {
    expect(areaOf(item({ project_id: 'pw' }), snapshot)).toBe('privat');
    expect(areaOf(item({ project_id: 'pg' }), snapshot)).toBe('privat');
    expect(areaOf(item({ project_id: 'ce' }), snapshot)).toBe('claude');
    expect(areaOf(item({ project_id: 'kunde' }), snapshot)).toBe('arbeit');
    expect(areaOf(item({ project_id: 'inbox', labels: ['privat_geplant'] }), snapshot)).toBe('privat');
  });

  it('der Eingang gehört zu keinem Bereich und steht nur unter „Alle“', () => {
    const task = item({ project_id: 'inbox' });
    expect(areaOf(task, snapshot)).toBeNull();
    expect(inAreas(task, snapshot, [])).toBe(true);
    expect(inAreas(task, snapshot, ['privat'])).toBe(false);
  });

  it('zählt je Bereich in fester Reihenfolge und behält gewählte ohne Aufgaben', () => {
    const items = [
      item({ id: '1', project_id: 'ag' }),
      item({ id: '2', project_id: 'pw' }),
      item({ id: '3', project_id: 'pg' }),
      item({ id: '4', project_id: 'inbox' }),
      item({ id: '5', project_id: 'ce' }),
    ];
    expect(quickAreas(items, snapshot, [])).toEqual([
      { area: 'privat', count: 2 },
      { area: 'arbeit', count: 1 },
      { area: 'claude', count: 1 },
    ]);
    expect(quickAreas([items[0]], snapshot, ['claude'])).toEqual([
      { area: 'arbeit', count: 1 },
      { area: 'claude', count: 0 },
    ]);
  });

  it('speichert Bereiche mit Vorsilbe und übergeht alte Projekt-IDs', () => {
    expect(areaKey('privat')).toBe('area:privat');
    expect(chosenAreas(['area:privat', '6Jf8VQXxpwv56VQ7', 'area:arbeit'])).toEqual(['privat', 'arbeit']);
  });

  it('Klick nimmt dazu oder heraus', () => {
    expect(toggleArea([], 'arbeit')).toEqual(['arbeit']);
    expect(toggleArea(['arbeit'], 'privat')).toEqual(['arbeit', 'privat']);
    expect(toggleArea(['arbeit'], 'arbeit')).toEqual([]);
  });
});
