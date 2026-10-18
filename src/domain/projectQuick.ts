import { labelSlug, parseListLabel, splitListName } from './lists';
import type { Item, Project, Snapshot } from './types';

/*
 * Schnellfilter nach Bereich im Seitenkopf (Heute, Demnächst, Woche …).
 * Die Todoist-Projekte heißen <Bereich>_<Liste> (privat_geplant, Arbeit_Geplant);
 * die Chips zeigen nur die Bereiche (Privat, Arbeit, Claude), nicht die Listen.
 * Aufgaben ohne Bereich (Eingang) gibt es nur unter „Alle“.
 *
 * Gespeichert wird die Auswahl in filters.projects als `area:<bereich>`. Ältere
 * Einträge (Projekt-IDs aus der Zeit der Projekt-Chips) zählen nicht mehr.
 */

const AREA_PREFIX = 'area:';

/** The stored filter value for a Bereich. */
export const areaKey = (area: string): string => `${AREA_PREFIX}${area}`;

/** The chosen Bereiche in a stored filter; anything else in it is left over and ignored. */
export function chosenAreas(stored: readonly string[]): string[] {
  return stored.filter((entry) => entry.startsWith(AREA_PREFIX)).map((entry) => entry.slice(AREA_PREFIX.length));
}

/**
 * Der Bereich einer Aufgabe, klein geschrieben („privat“), oder null.
 * Zuerst das Projekt (oder eins darüber) nach seinem Namen, dann ein Ordner
 * ganz oben, der wie ein Bereich heißt, zuletzt ein Listen-Label der Aufgabe.
 * Der Eingang gehört zu keinem Bereich.
 */
export function areaOf(item: Item, snapshot: Snapshot): string | null {
  let id: string | null | undefined = item.project_id;
  const seen = new Set<string>();
  while (id && !seen.has(id)) {
    seen.add(id);
    const project: Project | undefined = snapshot.projects[id];
    if (!project) break;
    const parts = splitListName(project.name);
    if (parts) return parts.area;
    if (project.is_folder && !project.parent_id) return labelSlug(project.name) || null;
    id = project.parent_id;
  }
  for (const label of item.labels) {
    const parts = splitListName(label) ?? parseListLabel(label);
    if (parts) return parts.area;
  }
  return null;
}

/** Whether a task is in one of the chosen Bereiche; none chosen lets everything through. */
export function inAreas(item: Item, snapshot: Snapshot, chosen: readonly string[]): boolean {
  if (chosen.length === 0) return true;
  const area = areaOf(item, snapshot);
  return area !== null && chosen.includes(area);
}

/** Die übliche Reihenfolge der Bereiche, wie in der Seitenleiste. */
export function areaRank(area: string): number {
  return ['privat', 'arbeit', 'claude'].indexOf(area) + 1 || 99;
}

export interface QuickArea {
  area: string;
  /** How many of the page's tasks are in it. */
  count: number;
}

/**
 * The chips to offer: every Bereich that has a task on the page, in sidebar
 * order, plus any chosen one that has none right now — so a choice can always
 * be undone where it was made.
 */
export function quickAreas(items: readonly Item[], snapshot: Snapshot, chosen: readonly string[]): QuickArea[] {
  const counts = new Map<string, number>();
  for (const item of items) {
    const area = areaOf(item, snapshot);
    if (area) counts.set(area, (counts.get(area) ?? 0) + 1);
  }
  for (const area of chosen) if (!counts.has(area)) counts.set(area, 0);
  return [...counts.entries()]
    .map(([area, count]) => ({ area, count }))
    .sort((a, b) => areaRank(a.area) - areaRank(b.area) || a.area.localeCompare(b.area));
}

/** Clicking a chip: add it to the choice or take it out. */
export function toggleArea(chosen: readonly string[], area: string): string[] {
  return chosen.includes(area) ? chosen.filter((entry) => entry !== area) : [...chosen, area];
}
