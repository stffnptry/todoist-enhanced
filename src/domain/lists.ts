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

/** Listen, deren Label es als Liste erkennt. Anderes bleibt ein normaler Tag. */
const KNOWN_LISTS = new Set(['wiederholend', 'geplant', 'eingang']);

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
  const match = /^([a-z0-9]+)_([a-z0-9]+)$/.exec(name.trim().toLowerCase());
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
export function newListLabel(area: string, name: string): string | null {
  const label = listLabel(area, name);
  return labelSlug(area) && labelSlug(name) ? label : null;
}
