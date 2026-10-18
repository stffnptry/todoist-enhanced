/**
 * Listen über Labels.
 *
 * Eine Liste wie „Wiederholende Aufgaben“ in einem Bereich wie „Privat“ ist in
 * Todoist kein eigenes Projekt, sondern ein Label: `privat_wiederholend`. Der
 * Bereich steht vorne, die Liste hinten. Die Labels sieht man in der App nicht;
 * sie sind nur der Weg, wie Todoist die Aufgaben zuordnet.
 *
 * Die Namen sind klein geschrieben und ohne Umlaute, damit sie in Todoist
 * überall gleich aussehen und sich nicht über Groß- und Kleinschreibung
 * streiten.
 */

/** Listen, deren Label es als Liste erkennt, auch ohne bekannten Bereich. */
const KNOWN_LISTS = new Set(['wiederholend', 'geplant', 'eingang']);

/*
 * Die Namen der Bereiche (Ordner) in Slug-Form. Der Store hält sie aktuell:
 * jedes Label, das mit einem Bereich beginnt, ist ein Listen- oder Projekt-
 * Label und wird nicht als Tag gezeigt, auch wenn der Rest frei gewählt ist.
 */
let knownAreas = new Set<string>();

/** Die Bereichsnamen, die gerade gelten; der Store ruft das bei jeder Änderung auf. */
export function setKnownAreas(names: string[]): void {
  knownAreas = new Set(names.map(labelSlug).filter(Boolean));
}

const DISPLAY_NAMES: Record<string, string> = {
  wiederholend: 'Wiederholende Aufgaben',
  geplant: 'Geplante Aufgaben',
  eingang: 'Eingang',
};

const UMLAUTS: Record<string, string> = { ä: 'ae', ö: 'oe', ü: 'ue', ß: 'ss' };

/** Ein Name als Label-Teil: klein, ohne Umlaute, Leerzeichen und Sonderzeichen. */
export function labelSlug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[äöüß]/g, (c) => UMLAUTS[c])
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

/** Das Label für eine Liste in einem Bereich: „Privat“ + „Geplante Aufgaben“ → `privat_geplant`. */
export function listLabel(area: string, list: string): string {
  return `${labelSlug(area)}_${labelSlug(list)}`;
}

/** Der Anzeigename einer Liste aus ihrem Label-Teil. */
export function listDisplayName(list: string): string {
  return DISPLAY_NAMES[list] ?? list.charAt(0).toUpperCase() + list.slice(1);
}

export interface ListLabel {
  area: string;
  list: string;
}

/** Zerlegt ein Label in Bereich und Liste, wenn es die Form `bereich_liste` hat. */
export function parseListLabel(name: string): ListLabel | null {
  const label = name.trim().toLowerCase();
  for (const area of knownAreas) {
    if (label.startsWith(`${area}_`) && label.length > area.length + 1) {
      return { area, list: label.slice(area.length + 1) };
    }
  }
  const match = /^([a-z0-9]+)_([a-z0-9]+)$/.exec(label);
  if (!match || !KNOWN_LISTS.has(match[2])) return null;
  return { area: match[1], list: match[2] };
}

/** Ein Listen-Label wird als Tag ausgeblendet. */
export const isListLabel = (name: string): boolean => parseListLabel(name) !== null;

/**
 * Die Liste einer Aufgabe: das erste Label, das zu einem der Bereiche passt.
 * `areas` sind die Bereichsnamen, so wie sie der Nutzer sieht („Privat“).
 */
export function listOf(labels: string[], areas: string[]): ListLabel | null {
  const known = new Set(areas.map(labelSlug));
  for (const label of labels) {
    const parsed = parseListLabel(label);
    if (parsed && known.has(parsed.area)) return parsed;
  }
  return null;
}

/**
 * Das Label für eine neue Liste im Bereich, oder `null`, wenn der Name keinen
 * brauchbaren Teil hergibt („!!!“). Ein Label ohne Aufgaben ist in Todoist
 * trotzdem ein richtiges Label, also ist eine leere Liste nur ein angelegtes
 * Label.
 */
/** The Bereich names of a snapshot's folders: top-level ones that are still in use. */
export function areaNames(projects: Record<string, { name: string; is_folder?: boolean; parent_id?: string | null; is_deleted?: boolean; is_archived?: boolean }>): string[] {
  return Object.values(projects)
    .filter((p) => p.is_folder && !p.parent_id && !p.is_deleted && !p.is_archived)
    .map((p) => p.name);
}

export function newListLabel(area: string, name: string): string | null {
  const label = listLabel(area, name);
  return labelSlug(area) && labelSlug(name) ? label : null;
}

/** Die Reihenfolge der Listen in einem Bereich: Eingang, dann die Wiederholenden, dann die Geplanten. */
export const LIST_ORDER = ['eingang', 'wiederholend', 'geplant'];

/**
 * Bereich und Liste aus dem Namen eines Labels oder Projekts („privat_geplant“,
 * „Claude_Eingang“), unabhängig davon, welche Bereiche es gibt. Der Bereich ist
 * klein geschrieben, die Liste ist eine der drei bekannten.
 */
export function splitListName(name: string): ListLabel | null {
  const match = /^([a-z0-9]+)_(wiederholend|geplant|eingang)$/i.exec(name.trim());
  return match ? { area: match[1].toLowerCase(), list: match[2].toLowerCase() } : null;
}

/** Ein Bereichsname für die Anzeige: „privat“ wird „Privat“. */
export function areaTitle(area: string): string {
  return area.charAt(0).toUpperCase() + area.slice(1);
}

/**
 * Was die App zu einer selbst angelegten Liste weiß und Todoist nicht: ob sie
 * eine einfache Liste oder ein Projekt ist, ihr Symbol und ihr Name, wie er
 * eingegeben wurde („Urlaub planen“ statt `urlaub_planen`). Ein Label hat in
 * Todoist kein Feld dafür, also liegt das in den Einstellungen und reist mit
 * ihnen zu den anderen Geräten.
 */
export type ListKind = 'list' | 'project';

export interface ListMeta {
  kind: ListKind;
  icon: string | null;
  name: string;
}

/** Die Listen-Angaben aus gespeicherten Einstellungen; Unbrauchbares fällt weg. */
export function readListMeta(raw: unknown): Record<string, ListMeta> {
  if (!raw || typeof raw !== 'object') return {};
  const result: Record<string, ListMeta> = {};
  for (const [label, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!value || typeof value !== 'object') continue;
    const v = value as Record<string, unknown>;
    if (typeof v.name !== 'string' || !v.name.trim()) continue;
    result[label] = {
      kind: v.kind === 'project' ? 'project' : 'list',
      icon: typeof v.icon === 'string' && /^[a-z0-9-]+$/.test(v.icon) ? v.icon : null,
      name: v.name.trim(),
    };
  }
  return result;
}

/**
 * Die Bereiche, die sich aus den Namen der Listen ergeben (`privat_geplant`,
 * `Claude_Eingang`). Damit erkennt die App auch selbst angelegte Listen wie
 * `privat_einkauf` als Liste, wenn der Bereich kein Todoist-Ordner ist.
 */
export function listAreas(names: string[]): string[] {
  const areas = new Set<string>();
  for (const name of names) {
    const parts = splitListName(name);
    if (parts) areas.add(parts.area);
  }
  return [...areas];
}

/** Die Reihenfolge in einem Bereich: die bekannten Listen zuerst, dann die übrigen nach Name. */
export function compareLists(a: { list: string; name: string }, b: { list: string; name: string }): number {
  const rank = (list: string) => {
    const at = LIST_ORDER.indexOf(list);
    return at === -1 ? LIST_ORDER.length : at;
  };
  return rank(a.list) - rank(b.list) || a.name.localeCompare(b.name);
}
