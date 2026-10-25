import { areaKeyOf, areasOf, placementOf } from './lists';
import type { Item, Snapshot } from './types';

/*
 * Schnellfilter nach Bereich im Seitenkopf (Heute, Demnächst, Woche …).
 * Die Chips zeigen die Bereiche (Hauptprojekte wie Privat, Arbeit), nicht die
 * Listen darin.
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

/** Der Bereich einer Aufgabe als Schlüssel („privat“), oder null. Der Eingang gehört zu keinem Bereich. */
export function areaOf(item: Item, snapshot: Snapshot): string | null {
  const placement = placementOf(snapshot.projects, item.project_id);
  return placement ? areaKeyOf(placement.area) : null;
}

/** Whether a task is in one of the chosen Bereiche; none chosen lets everything through. */
export function inAreas(item: Item, snapshot: Snapshot, chosen: readonly string[]): boolean {
  if (chosen.length === 0) return true;
  const area = areaOf(item, snapshot);
  return area !== null && chosen.includes(area);
}

export interface QuickArea {
  area: string;
  /** Der Name des Hauptprojekts, wie in Todoist. */
  name: string;
  color: string | null;
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
  const known = areasOf(snapshot.projects);
  const rank = (area: string) => {
    const at = known.findIndex((a) => a.key === area);
    return at === -1 ? known.length : at;
  };
  return [...counts.entries()]
    .map(([area, count]) => {
      const project = known.find((a) => a.key === area)?.project;
      return { area, name: project?.name ?? area, color: project?.color ?? null, count };
    })
    .sort((a, b) => rank(a.area) - rank(b.area) || a.area.localeCompare(b.area));
}

/** Clicking a chip: add it to the choice or take it out. */
export function toggleArea(chosen: readonly string[], area: string): string[] {
  return chosen.includes(area) ? chosen.filter((entry) => entry !== area) : [...chosen, area];
}
