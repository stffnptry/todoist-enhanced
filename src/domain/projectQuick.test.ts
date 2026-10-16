import { describe, expect, it } from 'vitest';
import { inProjects, quickProjects, rootProjectId, toggleProject } from './projectQuick';
import { emptySnapshot, type Project, type Snapshot } from './types';
import { item } from '@/test/items';

const project = (id: string, parent_id: string | null = null): Project => ({
  id, name: id, color: 'grey', parent_id, child_order: 0,
  is_archived: false, is_deleted: false, is_favorite: false,
});
const snapshot: Snapshot = {
  ...emptySnapshot(),
  projects: {
    arbeit: project('arbeit'),
    meetings: project('meetings', 'arbeit'),
    jour: project('jour', 'meetings'),
    privat: project('privat'),
  },
};
const order = ['arbeit', 'meetings', 'jour', 'privat'];
const rank = (id: string) => order.indexOf(id);

describe('Projekt-Schnellfilter', () => {
  it('führt Unterprojekte auf das Hauptprojekt zurück', () => {
    expect(rootProjectId(snapshot, 'jour')).toBe('arbeit');
    expect(rootProjectId(snapshot, 'privat')).toBe('privat');
    expect(rootProjectId(snapshot, 'unbekannt')).toBe('unbekannt');
  });

  it('ein gewähltes Projekt schließt seine Unterprojekte ein', () => {
    expect(inProjects(snapshot, 'jour', ['arbeit'])).toBe(true);
    expect(inProjects(snapshot, 'privat', ['arbeit'])).toBe(false);
    expect(inProjects(snapshot, 'privat', [])).toBe(true);
  });

  it('zählt je Hauptprojekt in Seitenleisten-Reihenfolge und behält gewählte ohne Aufgaben', () => {
    const items = [item({ id: '1', project_id: 'privat' }), item({ id: '2', project_id: 'jour' }), item({ id: '3', project_id: 'arbeit' })];
    expect(quickProjects(items, snapshot, [], rank)).toEqual([{ id: 'arbeit', count: 2 }, { id: 'privat', count: 1 }]);
    expect(quickProjects([items[0]], snapshot, ['arbeit'], rank)).toEqual([{ id: 'arbeit', count: 0 }, { id: 'privat', count: 1 }]);
  });

  it('Klick nimmt dazu oder heraus; alle gewählt heißt keine Einschränkung', () => {
    const offered = ['arbeit', 'privat', 'x'];
    expect(toggleProject([], 'arbeit', offered)).toEqual(['arbeit']);
    expect(toggleProject(['arbeit'], 'privat', offered)).toEqual(['arbeit', 'privat']);
    expect(toggleProject(['arbeit'], 'arbeit', offered)).toEqual([]);
    expect(toggleProject(['arbeit', 'privat'], 'x', offered)).toEqual([]);
  });
});
