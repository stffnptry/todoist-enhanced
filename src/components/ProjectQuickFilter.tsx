import { useMemo } from 'react';
import { useStore } from '@/store/store';
import { viewPrefs } from '@/store/prefs';
import { applyFilters, projectRanks } from '@/store/selectors';
import { quickProjects, toggleProject } from '@/domain/projectQuick';
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
 * Projekt-Chips im Seitenkopf neben „Ich habe Zeit“: ein Klick zeigt nur dieses
 * Projekt (mit Unterprojekten), weitere Klicks nehmen Projekte dazu, „Alle“
 * setzt zurück. Die Auswahl wird je Ansicht gemerkt (filters.projects).
 */
export function ProjectQuickFilter({ viewKey, pageItems, childrenOf }: ProjectQuickFilterProps) {
  const { t } = useT();
  const snapshot = useStore((s) => s.snapshot);
  const prefs = useStore((s) => s.prefs);
  const setViewPrefs = useStore((s) => s.setViewPrefs);
  const current = viewPrefs(prefs, viewKey);
  const chosen = current.filters.projects;

  const ranks = useMemo(() => projectRanks(snapshot), [snapshot]);
  const offered = useMemo(() => {
    /* Counted with every other filter applied but this one, so a chip never
       vanishes because it is not chosen. */
    const visible = applyFilters(pageItems, { ...current.filters, projects: [] }, snapshot, childrenOf);
    return quickProjects(visible, snapshot, chosen, (id) => ranks.get(id) ?? Number.MAX_SAFE_INTEGER);
  }, [pageItems, current.filters, snapshot, childrenOf, chosen, ranks]);

  // Nur ein Projekt auf der Seite und nichts gewählt: nichts zu filtern.
  if (offered.length < 2 && chosen.length === 0) return null;

  const set = (projects: string[]) => setViewPrefs(viewKey, { filters: { ...current.filters, projects } });
  const ids = offered.map((entry) => entry.id);

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
      {offered.map(({ id, count }) => {
        const project = snapshot.projects[id];
        const on = chosen.includes(id);
        const name = project?.inbox_project ? t('nav.inbox') : project?.name ?? '';
        return (
          <button
            key={id}
            type="button"
            className={`pquick-chip${on ? ' on' : ''}`}
            aria-pressed={on}
            title={t('pquick.hint', { name })}
            onClick={() => set(toggleProject(chosen, id, ids))}
          >
            <span className="pquick-dot" style={{ background: colorValue(project?.color) }} aria-hidden="true" />
            <span className="pquick-name">{name}</span>
            <span className="pquick-count">{count}</span>
          </button>
        );
      })}
    </span>
  );
}
