/**
 * Rechtsklick: dasselbe Menü wie die drei Punkte, nur am Mauszeiger.
 *
 * Jedes „…“-Menü der App hängt an einem Element, gegen dessen Rechteck es
 * sich platziert (unter dem Knopf, notfalls darüber, im Fenster gehalten).
 * Ein Rechtsklick hat keinen Knopf, sondern einen Punkt. Statt jedem Menü
 * eine zweite Platzierung beizubringen, bekommt es ein unsichtbares Element
 * der Größe null genau an dieser Stelle als Anker – die vorhandene Logik
 * rechnet damit unverändert weiter.
 *
 * Es gibt nur eins davon: Es kann ohnehin nur ein Kontextmenü offen sein, und
 * ein neuer Rechtsklick schließt das alte (mousedown außerhalb), bevor er das
 * Element versetzt.
 */

const ANCHOR_ID = 'context-anchor';

/** Das Ankerelement, an den Punkt des Ereignisses gesetzt. */
export function pointAnchor(at: { clientX: number; clientY: number }): HTMLElement {
  let anchor = document.getElementById(ANCHOR_ID);
  if (!anchor) {
    anchor = document.createElement('span');
    anchor.id = ANCHOR_ID;
    anchor.setAttribute('aria-hidden', 'true');
    anchor.style.cssText = 'position:fixed;width:0;height:0;pointer-events:none;visibility:hidden';
    document.body.appendChild(anchor);
  }
  anchor.style.left = `${at.clientX}px`;
  anchor.style.top = `${at.clientY}px`;
  return anchor;
}

/** Ob ein Menü am Mauszeiger hängt statt an einem Knopf – dann links bündig, wie unter macOS. */
export function isPointAnchor(anchor: Element | null | undefined): boolean {
  return anchor?.id === ANCHOR_ID;
}

/**
 * Ob ein Rechtsklick dem Text gehört statt dem Ding darunter.
 *
 * In einem Eingabefeld oder auf markiertem Text erwartet man Ausschneiden,
 * Kopieren, Einfügen – das liefert die Mac-Hülle (main.js). Dort öffnet die
 * App also kein eigenes Menü.
 */
export function leaveToText(event: Event): boolean {
  const target = event.target as HTMLElement | null;
  if (target?.closest?.('input, textarea, select, [contenteditable=""], [contenteditable="true"]')) return true;
  const selection = window.getSelection?.();
  if (selection && !selection.isCollapsed && selection.toString().trim() !== '') {
    const node = selection.anchorNode;
    const element = node instanceof Element ? node : node?.parentElement;
    if (element && target && (element === target || element.contains(target) || target.contains(element))) return true;
  }
  return false;
}
