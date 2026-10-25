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
    privat: project('privat', 'Privat', { child_order: 1, color: 'lime_green' }),
    pw: project('pw', 'Privat wiederholend', { parent_id: 'privat' }),
    pg: project('pg', 'Privat geplant', { parent_id: 'privat' }),
    arbeit: project('arbeit', 'Arbeit', { child_order: 2 }),
    ag: project('ag', 'Arbeit geplant', { parent_id: 'arbeit' }),
    kunde: project('kunde', 'Kunde A', { parent_id: 'ag' }),
    dev: project('dev', 'Development', { child_order: 3 }),
    ce: project('ce', 'Claude Eingang', { parent_id: 'dev' }),
    allein: project('allein', 'Urlaub', { child_order: 4 }),
  },
};

describe('Bereichs-Schnellfilter', () => {
  it('liest den Bereich aus dem Hauptprojekt, auch direkt darin und tiefer verschachtelt', () => {
    expect(areaOf(item({ project_id: 'pw' }), snapshot)).toBe('privat');
    expect(areaOf(item({ project_id: 'privat' }), snapshot)).toBe('privat');
    expect(areaOf(item({ project_id: 'ce' }), snapshot)).toBe('development');
    expect(areaOf(item({ project_id: 'kunde' }), snapshot)).toBe('arbeit');
    expect(areaOf(item({ project_id: 'allein' }), snapshot)).toBeNull();
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
      { area: 'privat', name: 'Privat', color: 'lime_green', count: 2 },
      { area: 'arbeit', name: 'Arbeit', color: 'grey', count: 1 },
      { area: 'development', name: 'Development', color: 'grey', count: 1 },
    ]);
    expect(quickAreas([items[0]], snapshot, ['development']).map((a) => [a.area, a.count])).toEqual([
      ['arbeit', 1],
      ['development', 0],
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
