import { useEffect, useState } from 'react';
import { Overlay } from './Overlay';
import { Icon } from '../Icon';
import { Select } from '../Select';
import { ProjectIcon, ProjectIconGrid } from '../ProjectIconPicker';
import { useT } from '@/hooks/useT';
import { useStore } from '@/store/store';
import { areaTitle, newListLabel, type ListKind } from '@/domain/lists';

/** Das Symbol, mit dem eine neue Liste startet (wie in Steffens Entwurf). */
const DEFAULT_ICON = 'list';

/**
 * Eine neue Liste in einem Bereich anlegen: Name, Listentyp, Symbol.
 *
 * Beide Listentypen werden ein Label im Bereich („privat_einkauf“): Todoists
 * kostenloser Tarif hat nur fünf Projekte, und die sind mit den festen Listen
 * belegt. Was Todoist an einem Label nicht speichern kann – Listentyp, Symbol
 * und der Name, wie er eingegeben wurde –, liegt in den Einstellungen
 * (`listMeta`) und reist mit ihnen.
 */
export function AreaListSheet({ area, onClose }: { area: string | null; onClose: () => void }) {
  const { t } = useT();
  const labels = useStore((s) => s.snapshot.labels);
  const listMeta = useStore((s) => s.prefs.listMeta);
  const createLabel = useStore((s) => s.createLabel);
  const setPrefs = useStore((s) => s.setPrefs);

  const [name, setName] = useState('');
  const [kind, setKind] = useState<ListKind>('list');
  const [icon, setIcon] = useState<string | null>(DEFAULT_ICON);
  const [iconOpen, setIconOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  /* Jedes Öffnen beginnt leer. */
  useEffect(() => {
    if (!area) return;
    setName('');
    setKind('list');
    setIcon(DEFAULT_ICON);
    setIconOpen(false);
  }, [area]);

  const label = area ? newListLabel(area, name) : null;
  const taken = Boolean(label && Object.values(labels).some((l) => !l.is_deleted && l.name.toLowerCase() === label));
  const unusable = name.trim() !== '' && !label;
  const ready = Boolean(label) && !taken && !busy;

  async function submit() {
    if (!ready || !label) return;
    setBusy(true);
    try {
      setPrefs({ listMeta: { ...listMeta, [label]: { kind, icon, name: name.trim() } } });
      await createLabel(label);
      onClose();
    } finally {
      setBusy(false);
    }
  }

  const title = area ? t('area.newTitle', { area: areaTitle(area) }) : '';

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

        <span className="listform-label">{t('area.kind')}</span>
        <div className="listform-field">
          <Select
            value={kind}
            ariaLabel={t('area.kind')}
            matchWidth
            options={[
              { value: 'list', label: t('area.kindList') },
              { value: 'project', label: t('area.kindProject') },
            ]}
            onChange={(next) => setKind(next === 'project' ? 'project' : 'list')}
          />
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
