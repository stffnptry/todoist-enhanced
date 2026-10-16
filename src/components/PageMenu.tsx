import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Icon, type IconName } from './Icon';
import { useT } from '@/hooks/useT';
import { leaveToText, pointAnchor } from '@/lib/contextMenu';

export interface PageMenuItem {
  key: string;
  label: string;
  icon?: IconName;
  /** Drawn with a tick: the current choice among several. */
  checked?: boolean;
  /** Drawn in the warning colour: it deletes something. */
  danger?: boolean;
  onPick: () => void;
}

/**
 * The three dots on a page that is not a project: what can be done to the page
 * itself, in one small list. A project has its own, richer menu.
 */
export function PageMenu({ items, label, contextOn }: {
  items: PageMenuItem[];
  label?: string;
  /**
   * Der Bereich, dessen Rechtsklick dieses Menü öffnet (ein Selektor für den
   * nächsten Vorfahren, etwa die Kopfzeile der Seite oder die Karte, auf der
   * die drei Punkte sitzen). Dann hängt es am Mauszeiger.
   */
  contextOn?: string;
}) {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  /** Per Rechtsklick geöffnet: wo der Zeiger war. */
  const [point, setPoint] = useState<HTMLElement | null>(null);
  const wrap = useRef<HTMLSpanElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const name = label ?? t('page.actions');

  useEffect(() => {
    if (!contextOn) return;
    const host = wrap.current?.closest<HTMLElement>(contextOn);
    if (!host) return;
    const onContext = (event: MouseEvent) => {
      if (event.defaultPrevented || leaveToText(event)) return;
      event.preventDefault();
      setPoint(pointAnchor(event));
      setOpen(true);
    };
    host.addEventListener('contextmenu', onContext);
    return () => host.removeEventListener('contextmenu', onContext);
  }, [contextOn]);

  useEffect(() => { if (!open) setPoint(null); }, [open]);

  /* Am Zeiger: dort beginnen, aber im Fenster bleiben. */
  useLayoutEffect(() => {
    const menu = list.current;
    if (!open || !point || !menu) return;
    const margin = 8;
    const at = point.getBoundingClientRect();
    const left = Math.min(at.left, window.innerWidth - menu.offsetWidth - margin);
    const top = at.top + menu.offsetHeight > window.innerHeight - margin
      ? at.top - menu.offsetHeight
      : at.top;
    menu.style.left = `${Math.max(margin, left)}px`;
    menu.style.top = `${Math.max(margin, top)}px`;
    menu.style.visibility = '';
  }, [open, point]);

  useEffect(() => {
    if (!open) return;
    const away = (event: MouseEvent) => {
      const target = event.target as Node;
      if (wrap.current?.contains(target) || list.current?.contains(target)) return;
      setOpen(false);
    };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('mousedown', away); document.removeEventListener('keydown', escape); };
  }, [open]);

  const options = (
    <div
      className={`popover pagemenu-list${point ? ' atpoint' : ''}`}
      role="menu"
      aria-label={name}
      ref={list}
      style={point ? { visibility: 'hidden' } : undefined}
    >
      {items.map((item) => (
        <button
          key={item.key}
          type="button"
          className={`opt${item.danger ? ' danger' : ''}`}
          role="menuitemradio"
          aria-checked={item.checked}
          onClick={() => { setOpen(false); item.onPick(); }}
        >
          {item.icon && <Icon name={item.icon} size="sm" />}
          <span>{item.label}</span>
          {item.checked && <Icon name="check" size="sm" />}
        </button>
      ))}
    </div>
  );

  return (
    <span className="pmenu-wrap pagemenu" ref={wrap}>
      <button
        type="button"
        className="iconbtn"
        aria-label={name}
        title={name}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <Icon name="more" />
      </button>
      {open && !point && options}
      {/* Am Zeiger ins Dokument gezeichnet: Eine Karte oder Kopfzeile kann
          das Menü sonst an ihren Rändern abschneiden. */}
      {open && point && createPortal(options, document.body)}
    </span>
  );
}
