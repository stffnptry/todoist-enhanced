/*
 * Scrollen durch die Abdeckung eines Seitenpanels.
 *
 * Ein Seitenpanel (Aufgabe, Einblicke) liegt über einer unsichtbaren
 * Abdeckung, die den Klick daneben als „schließen“ fängt. Sie fing aber auch
 * das Mausrad: Die Liste oder der Kalender dahinter ließ sich nicht mehr
 * scrollen, solange eine Aufgabe offen war. Die Abdeckung gibt das Rad deshalb
 * an das weiter, was unter dem Zeiger liegt und sich in die Richtung bewegen
 * lässt.
 */

/** Just the parts of an element the search below reads; a DOM element fits. */
export interface ScrollBox {
  scrollTop: number;
  scrollLeft: number;
  scrollHeight: number;
  scrollWidth: number;
  clientHeight: number;
  clientWidth: number;
  parentElement: ScrollBox | null;
}

/**
 * The nearest box, from `start` outwards, that can still move by `delta` along
 * the axis: one whose overflow scrolls and that is not already at that end.
 * `overflowOf` reads the computed overflow; the page itself (`root`) scrolls
 * unless it is hidden.
 */
export function scrollTarget<T extends ScrollBox>(
  start: T | null,
  axis: 'x' | 'y',
  delta: number,
  overflowOf: (el: T) => string,
  root: T | null,
): T | null {
  if (delta === 0) return null;
  for (let el = start; el; el = el.parentElement as T | null) {
    const size = axis === 'y' ? el.scrollHeight - el.clientHeight : el.scrollWidth - el.clientWidth;
    if (size <= 1) continue;
    const overflow = overflowOf(el);
    const scrolls = el === root ? overflow !== 'hidden' && overflow !== 'clip' : /auto|scroll|overlay/.test(overflow);
    if (!scrolls) continue;
    const at = axis === 'y' ? el.scrollTop : el.scrollLeft;
    if (delta < 0 ? at > 0 : at < size - 1) return el;
  }
  return null;
}

/** A wheel's delta in pixels: some mice report lines or pages instead. */
export function wheelPixels(delta: number, mode: number, page: number): number {
  return mode === 1 ? delta * 16 : mode === 2 ? delta * page : delta;
}

/**
 * Hands a wheel turn on `cover` to whatever lies beneath it at the pointer.
 * The cover (and the dialog it belongs to) is skipped, so the box found is on
 * the page behind.
 */
export function scrollThrough(e: WheelEvent, cover: Element): void {
  if (e.ctrlKey) return; // Pinch-Zoom am Trackpad, kein Scrollen
  const dialog = cover.parentElement ?? cover;
  const under = document
    .elementsFromPoint(e.clientX, e.clientY)
    .find((el) => !dialog.contains(el)) as HTMLElement | undefined;
  if (!under) return;
  const root = (document.scrollingElement ?? document.documentElement) as HTMLElement;
  const overflowY = (el: HTMLElement) => getComputedStyle(el).overflowY;
  const overflowX = (el: HTMLElement) => getComputedStyle(el).overflowX;
  // Shift + Rad scrollt am Mac seitwärts; der Browser meldet das schon als deltaX.
  const dy = wheelPixels(e.deltaY, e.deltaMode, window.innerHeight);
  const dx = wheelPixels(e.deltaX, e.deltaMode, window.innerWidth);
  const y = scrollTarget(under, 'y', dy, overflowY, root);
  const x = scrollTarget(under, 'x', dx, overflowX, root);
  if (y) y.scrollTop += dy;
  if (x) x.scrollLeft += dx;
}
