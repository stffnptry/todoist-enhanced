import { useEffect, useState } from 'react';
import { Overlay } from './Overlay';
import { Icon } from '../Icon';
import { ProjectIcon, ProjectIconGrid } from '../ProjectIconPicker';
import { useT } from '@/hooks/useT';
import { useStore } from '@/store/store';
import { withProjectIcon } from '@/domain/projectIcons';
import type { Project } from '@/domain/types';

/** Das Symbol, mit dem eine neue Liste startet (wie in Steffens Entwurf). */
const DEFAULT_ICON = 'list';

/**
 * Eine neue Liste in einem Bereich anlegen: Name und Symbol.
 *
 * Die Liste wird ein echtes Unterprojekt des Bereichs in Todoist, in seiner
 * Farbe. Das Symbol reist wie bei jedem Projekt in der Beschreibung mit
 * (`domain/projectIcons.ts`).
 */
export function AreaListSheet({ area, onClose }: { area: Project | null; onClose: () => void }) {
  const { t } = useT();
  const projects = useStore((s) => s.snapshot.projects);
  const createProject = useStore((s) => s.createProject);

  const [name, setName] = useState('');
  const [icon, setIcon] = useState<string | null>(DEFAULT_ICON);
  const [iconOpen, setIconOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  /* Jedes Öffnen beginnt leer. */
  useEffect(() => {
    if (!area) return;
    setName('');
    setIcon(DEFAULT_ICON);
    setIconOpen(false);
  }, [area]);

  const wanted = name.trim();
  const taken = Boolean(area && wanted && Object.values(projects).some((p) =>
    !p.is_deleted && !p.is_archived && p.parent_id === area.id && p.name.toLowerCase() === wanted.toLowerCase()));
  const unusable = name !== '' && !/[\p{L}\p{N}]/u.test(name);
  const ready = Boolean(area && wanted) && !unusable && !taken && !busy;

  async function submit() {
    if (!ready || !area) return;
    setBusy(true);
    try {
      await createProject(wanted, area.color, null, null, { parentId: area.id, description: withProjectIcon('', icon) });
      onClose();
    } finally {
      setBusy(false);
    }
  }

  const title = area ? t('area.newTitle', { area: area.name }) : '';

  return (
    <Overlay open={area !== null} onClose={onClose} label={title} size="sm">
      <div className="sheet-head">
        <h2>{title}</h2>
        <button className="iconbtn" aria-label={t('common.close')} onClick={onClose}>
          <Icon name="close" />
        </button>
      </div>

      <div className="sheet-body listform">
        <label className="listform-label" htmlFor="area-list-name">{t('area.name')}</label>
        <div className="listform-field">
          <input
            id="area-list-name"
            className="textfield"
            data-autofocus
            value={name}
            autoComplete="off"
            aria-invalid={taken || unusable || undefined}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void submit(); } }}
          />
          {taken && <span className="filtererror">{t('area.taken')}</span>}
          {unusable && <span className="filtererror">{t('area.unusable')}</span>}
        </div>

        <span className="listform-label">{t('area.icon')}</span>
        <div className="listform-field">
          <button
            type="button"
            className={`listform-icon${iconOpen ? ' open' : ''}`}
            aria-label={t('project.changeIcon')}
            title={t('project.changeIcon')}
            aria-expanded={iconOpen}
            onClick={() => setIconOpen((v) => !v)}
          >
            {icon ? <ProjectIcon iconId={icon} /> : <Icon name="tag" />}
          </button>
        </div>

        {/* React 18's types do not know `inert` yet; the browser does. */}
        <div className={`iconfold listform-wide${iconOpen ? ' open' : ''}`} {...({ inert: iconOpen ? undefined : '' } as object)}>
          <div className="iconfold-in">
            <ProjectIconGrid value={icon} onPick={(next) => { setIcon(next); setIconOpen(false); }} />
          </div>
        </div>
      </div>

      <div className="sheet-foot">
        <button className="btn quiet" onClick={onClose}>{t('common.cancel')}</button>
        <button className="btn primary" disabled={!ready} onClick={() => void submit()}>{t('area.ok')}</button>
      </div>
    </Overlay>
  );
}
