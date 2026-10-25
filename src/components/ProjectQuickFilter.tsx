import { useMemo } from 'react';
import { useStore } from '@/store/store';
import { viewPrefs } from '@/store/prefs';
import { applyFilters } from '@/store/selectors';
import { areaKey, chosenAreas, quickAreas, toggleArea } from '@/domain/projectQuick';
import { colorValue } from '@/domain/colors';
import { useT } from '@/hooks/useT';
import type { Item } from '@/domain/types';

interface ProjectQuickFilterProps {
  viewKey: string;
  /** The page's tasks before any filter, like the Display menu gets them. */
  pageItems: Item[];
  childrenOf: (id: string) => Item[];
}

/**
 * Bereichs-Chips im Seitenkopf neben „Ich habe Zeit“: ein Klick zeigt nur diesen
 * Bereich (Privat, Arbeit … – alle Listen darin), weitere Klicks nehmen
 * Bereiche dazu, „Alle“ setzt zurück. Aufgaben ohne Bereich (Eingang) stehen
 * nur unter „Alle“. Die Auswahl wird je Ansicht gemerkt (filters.projects).
 */
export function ProjectQuickFilter({ viewKey, pageItems, childrenOf }: ProjectQuickFilterProps) {
  const { t } = useT();
  const snapshot = useStore((s) => s.snapshot);
  const prefs = useStore((s) => s.prefs);
  const setViewPrefs = useStore((s) => s.setViewPrefs);
  const current = viewPrefs(prefs, viewKey);
  const chosen = useMemo(() => chosenAreas(current.filters.projects), [current.filters.projects]);

  const { offered, total } = useMemo(() => {
    /* Counted with every other filter applied but this one, so a chip never
       vanishes because it is not chosen. */
    const visible = applyFilters(pageItems, { ...current.filters, projects: [] }, snapshot, childrenOf);
    return { offered: quickAreas(visible, snapshot, chosen), total: visible.length };
  }, [pageItems, current.filters, snapshot, childrenOf, chosen]);

  /* Nichts gewählt und ein Klick würde nichts ändern (kein Bereich, oder alle
     Aufgaben im selben): nichts zu filtern. */
  const pointless = offered.length === 0 || (offered.length === 1 && offered[0].count === total);
  if (chosen.length === 0 && pointless) return null;

  const set = (areas: string[]) => setViewPrefs(viewKey, { filters: { ...current.filters, projects: areas.map(areaKey) } });

  return (
    <span className="pquick" role="group" aria-label={t('pquick.label')}>
      <button
        type="button"
        className={`pquick-chip${chosen.length === 0 ? ' on' : ''}`}
        aria-pressed={chosen.length === 0}
        onClick={() => set([])}
      >
        {t('pquick.all')}
      </button>
      {offered.map(({ area, name, color, count }) => {
        const on = chosen.includes(area);
        return (
          <button
            key={area}
            type="button"
            className={`pquick-chip${on ? ' on' : ''}`}
            aria-pressed={on}
            title={t('pquick.hint', { name })}
            onClick={() => set(toggleArea(chosen, area))}
          >
            <span className="pquick-dot" style={{ background: colorValue(color) }} aria-hidden="true" />
            <span className="pquick-name">{name}</span>
            <span className="pquick-count">{count}</span>
          </button>
        );
      })}
    </span>
  );
}
