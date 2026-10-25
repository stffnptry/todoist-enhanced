import type { Project } from './types';

/**
 * Bereiche und Listen aus Todoists Projektbaum.
 *
 * Ein Bereich („Privat“, „Arbeit“, „Development“) ist ein Projekt ganz oben im
 * eigenen Bereich von Todoist, das Unterprojekte hat. Die Unterprojekte sind
 * seine Listen („Privat geplant“, „Gedanken & Ideen“). Aufgaben, die direkt im
 * Hauptprojekt liegen, gehören zum Bereich, aber zu keiner Liste; die App zeigt
 * sie als „Allgemein“.
 *
 * Früher (Todoist Free, höchstens fünf Projekte) hingen Bereich und Liste am
 * Namen („Privat_Geplant“) oder an einem Label („privat_einkauf“). Seit Pro
 * zählt nur noch der Baum; die Namen sind frei.
 */

const UMLAUTS: Record<string, string> = { ä: 'ae', ö: 'oe', ü: 'ue', ß: 'ss' };

/** Ein Name als Schlüssel: klein, ohne Umlaute, Leerzeichen und Sonderzeichen. */
export function labelSlug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[äöüß]/g, (c) => UMLAUTS[c])
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

export interface Area {
  /** Stabiler Schlüssel für gespeicherte Filter: der Name in Slug-Form („privat“). */
  key: string;
  project: Project;
  /** Die Unterprojekte in Todoists Reihenfolge. */
  lists: Project[];
}

const live = (p: Project | undefined): p is Project => Boolean(p) && !p!.is_deleted && !p!.is_archived;
const byChildOrder = (a: Project, b: Project) => a.child_order - b.child_order || a.name.localeCompare(b.name);

/** Der Schlüssel eines Bereichs; ein Name ohne Buchstaben fällt auf die ID zurück. */
export const areaKeyOf = (project: Project): string => labelSlug(project.name) || project.id;

/** Ob ein Projekt als Bereich taugt: ganz oben, eigenes Konto, nicht der Eingang. */
const canBeArea = (p: Project) => !p.parent_id && !p.inbox_project && !p.workspace_id;

/** Die Bereiche: Hauptprojekte mit mindestens einem Unterprojekt, in Todoists Reihenfolge. */
export function areasOf(projects: Record<string, Project>): Area[] {
  const children = new Map<string, Project[]>();
  for (const p of Object.values(projects)) {
    if (!live(p) || !p.parent_id) continue;
    children.set(p.parent_id, [...(children.get(p.parent_id) ?? []), p]);
  }
  return Object.values(projects)
    .filter((p) => live(p) && canBeArea(p) && children.has(p.id))
    .sort(byChildOrder)
    .map((project) => ({ key: areaKeyOf(project), project, lists: [...children.get(project.id)!].sort(byChildOrder) }));
}

export interface Placement {
  area: Project;
  /** Das Unterprojekt direkt unter dem Bereich, in dem die Aufgabe liegt; null = direkt im Bereich. */
  list: Project | null;
}

/** Bereich und Liste eines Projekts (auch eines tiefer verschachtelten), oder null außerhalb der Bereiche. */
export function placementOf(projects: Record<string, Project>, projectId: string | null | undefined): Placement | null {
  const path: Project[] = [];
  const seen = new Set<string>();
  let id = projectId;
  while (id && !seen.has(id)) {
    seen.add(id);
    const project = projects[id];
    if (!project) return null;
    path.unshift(project);
    id = project.parent_id;
  }
  const area = path[0];
  if (!area || !live(area) || !canBeArea(area)) return null;
  const hasLists = Object.values(projects).some((p) => live(p) && p.parent_id === area.id);
  if (!hasLists) return null;
  return { area, list: path[1] ?? null };
}

/** Die Art einer Liste nach dem letzten Wort ihres Namens, für ihr Symbol: „Privat wiederholend“ → wiederholend. */
export function listKind(name: string): 'eingang' | 'wiederholend' | 'geplant' | null {
  const match = /(?:^|[\s_-])(eingang|wiederholend|geplant)$/i.exec(name.trim());
  return match ? (match[1].toLowerCase() as 'eingang' | 'wiederholend' | 'geplant') : null;
}

/** „Privat · Privat geplant“ für eine Liste, „Privat · {general}“ direkt im Bereich, sonst der Projektname. */
export function placementTitle(projects: Record<string, Project>, projectId: string, general: string): string | null {
  const placement = placementOf(projects, projectId);
  if (!placement) return null;
  return `${placement.area.name} · ${placement.list?.name ?? general}`;
}
