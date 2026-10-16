import type { Item, Snapshot } from './types';

/*
 * Schnellfilter nach Projekt im Seitenkopf (Heute, Demnächst, Woche …).
 * Gefiltert wird nach Hauptprojekten: Wer „Arbeit“ wählt, sieht auch die
 * Aufgaben aus den Unterprojekten von „Arbeit“ – so liest sich der Filter
 * wie die Seitenleiste, und Ordner funktionieren gleich mit.
 */

/** The top-level project a project sits under, or itself. Guards against a cycle in bad data. */
export function rootProjectId(snapshot: Snapshot, projectId: string): string {
  let id = projectId;
  const seen = new Set<string>();
  for (;;) {
    const parent = snapshot.projects[id]?.parent_id;
    if (!parent || seen.has(parent) || !snapshot.projects[parent]) return id;
    seen.add(id);
    id = parent;
  }
}

/** Whether a task's project is one of the chosen ones or lies under one of them. */
export function inProjects(snapshot: Snapshot, projectId: string, chosen: readonly string[]): boolean {
  if (chosen.length === 0) return true;
  let id: string | null | undefined = projectId;
  const seen = new Set<string>();
  while (id && !seen.has(id)) {
    if (chosen.includes(id)) return true;
    seen.add(id);
    id = snapshot.projects[id]?.parent_id;
  }
  return false;
}

export interface QuickProject {
  id: string;
  /** How many of the page's tasks are in it (with its subprojects). */
  count: number;
}

/**
 * The chips to offer: every top-level project that has a task on the page,
 * in sidebar order, plus any chosen one that has none right now — so a choice
 * can always be undone where it was made.
 */
export function quickProjects(
  items: readonly Item[],
  snapshot: Snapshot,
  chosen: readonly string[],
  rank: (id: string) => number,
): QuickProject[] {
  const counts = new Map<string, number>();
  for (const item of items) {
    const root = rootProjectId(snapshot, item.project_id);
    counts.set(root, (counts.get(root) ?? 0) + 1);
  }
  for (const id of chosen) if (!counts.has(id) && snapshot.projects[id]) counts.set(id, 0);
  return [...counts.entries()]
    .map(([id, count]) => ({ id, count }))
    .sort((a, b) => rank(a.id) - rank(b.id) || a.id.localeCompare(b.id));
}

/** Clicking a chip: add it to the choice or take it out. Choosing every offered one is the same as none. */
export function toggleProject(chosen: readonly string[], id: string, offered: readonly string[]): string[] {
  const next = chosen.includes(id) ? chosen.filter((entry) => entry !== id) : [...chosen, id];
  return offered.length > 1 && offered.every((entry) => next.includes(entry)) ? [] : next;
}
