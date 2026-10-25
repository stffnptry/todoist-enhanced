import { describe, expect, it } from 'vitest';
import { areasOf, labelSlug, listKind, placementOf, placementTitle } from './lists';
import type { Project } from './types';

const project = (id: string, name: string, extra: Partial<Project> = {}): Project => ({
  id, name, color: 'grey', parent_id: null, child_order: 0,
  is_archived: false, is_deleted: false, is_favorite: false, ...extra,
});
const projects: Record<string, Project> = {
  inbox: project('inbox', 'Inbox', { inbox_project: true }),
  arbeit: project('arbeit', 'Arbeit', { child_order: 2 }),
  privat: project('privat', 'Privat', { child_order: 1 }),
  pw: project('pw', 'Privat wiederholend', { parent_id: 'privat', child_order: 3 }),
  pg: project('pg', 'Privat geplant', { parent_id: 'privat', child_order: 1 }),
  ideen: project('ideen', 'Gedanken & Ideen', { parent_id: 'privat', child_order: 2 }),
  alt: project('alt', 'Alt', { parent_id: 'privat', is_archived: true }),
  ag: project('ag', 'Arbeit geplant', { parent_id: 'arbeit' }),
  kunde: project('kunde', 'Kunde A', { parent_id: 'ag' }),
  urlaub: project('urlaub', 'Urlaub', { child_order: 3 }),
  team: project('team', 'Team', { workspace_id: 'w1' }),
  teamkind: project('teamkind', 'Team geplant', { parent_id: 'team', workspace_id: 'w1' }),
};

describe('Bereiche aus dem Projektbaum', () => {
  it('nimmt Hauptprojekte mit Unterprojekten, in Todoists Reihenfolge, ohne Eingang und Team-Projekte', () => {
    const areas = areasOf(projects);
    expect(areas.map((a) => a.key)).toEqual(['privat', 'arbeit']);
    expect(areas[0].lists.map((p) => p.name)).toEqual(['Privat geplant', 'Gedanken & Ideen', 'Privat wiederholend']);
  });

  it('findet Bereich und Liste, auch direkt im Bereich und tiefer verschachtelt', () => {
    expect(placementOf(projects, 'pg')).toEqual({ area: projects.privat, list: projects.pg });
    expect(placementOf(projects, 'privat')).toEqual({ area: projects.privat, list: null });
    expect(placementOf(projects, 'kunde')).toEqual({ area: projects.arbeit, list: projects.ag });
    expect(placementOf(projects, 'urlaub')).toBeNull();
    expect(placementOf(projects, 'inbox')).toBeNull();
    expect(placementOf(projects, 'teamkind')).toBeNull();
    expect(placementOf(projects, 'weg')).toBeNull();
  });

  it('benennt die Liste mit Bereich davor', () => {
    expect(placementTitle(projects, 'pg', 'Allgemein')).toBe('Privat · Privat geplant');
    expect(placementTitle(projects, 'privat', 'Allgemein')).toBe('Privat · Allgemein');
    expect(placementTitle(projects, 'urlaub', 'Allgemein')).toBeNull();
  });

  it('erkennt die Art einer Liste am letzten Wort', () => {
    expect(listKind('Privat wiederholend')).toBe('wiederholend');
    expect(listKind('Arbeit geplant')).toBe('geplant');
    expect(listKind('Claude Eingang')).toBe('eingang');
    expect(listKind('Gedanken & Ideen')).toBeNull();
    expect(listKind('Geplanter Umzug')).toBeNull();
  });

  it('macht aus Namen Schlüssel ohne Umlaute', () => {
    expect(labelSlug('Über Bereich')).toBe('ueber_bereich');
  });
});
