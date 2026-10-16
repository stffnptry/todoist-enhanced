import { Fragment, useEffect, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import { Icon, type IconName } from './Icon';
import { useMenuKeys } from '@/hooks/useMenuKeys';

export interface ContextMenuItem {
  key: string;
  label: string;
  icon?: IconName;
  /** In der Warnfarbe: löscht etwas. */
  danger?: boolean;
  /** Ein Strich davor: eine neue Gruppe. */
  separated?: boolean;
  onPick: () => void;
}

/**
 * Ein Rechtsklick-Menü für Stellen, die (noch) kein „…“-Menü haben – die
 * Blöcke und Termine im Kalender. Wo es eins gibt, öffnet der Rechtsklick
 * dieses selbst am Zeiger (siehe `lib/contextMenu.ts`), damit beide Wege
 * immer dieselben Einträge haben.
 *
 * Hängt am Zeiger, bleibt im Fenster, geht bei Klick daneben, Escape, Scrollen
 * und Fenstergröße weg; Pfeiltasten wie in jedem Menü der App.
 */
export function ContextMenu({ anchor, items, label, onClose }: {
  /** Der Punkt aus `pointAnchor()`. */
  anchor: HTMLElement;
  items: ContextMenuItem[];
  label: string;
  onClose: () => void;
}) {
  const ref = useMenuKeys(true, onClose);

  useLayoutEffect(() => {
    const menu = ref.current;
    if (!menu) return;
    const margin = 8;
    const at = anchor.getBoundingClientRect();
    const left = Math.min(at.left, window.innerWidth - menu.offsetWidth - margin);
    const top = at.top + menu.offsetHeight > window.innerHeight - margin
      ? at.top - menu.offsetHeight
      : at.top;
    menu.style.left = `${Math.max(margin, left)}px`;
    menu.style.top = `${Math.max(margin, top)}px`;
    menu.style.visibility = '';
  }, [anchor, items, ref]);

  useEffect(() => {
    const away = (event: MouseEvent) => {
      if (ref.current?.contains(event.target as Node)) return;
      onClose();
    };
    document.addEventListener('mousedown', away);
    window.addEventListener('resize', onClose);
    window.addEventListener('scroll', onClose, true);
    return () => {
      document.removeEventListener('mousedown', away);
      window.removeEventListener('resize', onClose);
      window.removeEventListener('scroll', onClose, true);
    };
  }, [onClose, ref]);

  return createPortal(
    <div
      className="popover rowmenu contextmenu"
      role="menu"
      aria-label={label}
      ref={ref}
      style={{ visibility: 'hidden' }}
    >
      {items.map((item) => (
        <Fragment key={item.key}>
          {item.separated && <hr />}
          <button
            type="button"
            className={`opt${item.danger ? ' danger' : ''}`}
            role="menuitem"
            onClick={() => { onClose(); item.onPick(); }}
          >
            <span>{item.icon && <Icon name={item.icon} size="sm" />} {item.label}</span>
          </button>
        </Fragment>
      ))}
    </div>,
    document.body,
  );
}
