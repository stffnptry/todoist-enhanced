import { useState, type FormEvent } from 'react';
import { useT } from '@/hooks/useT';
import { useCreateList } from '@/hooks/useCreateList';

/**
 * Unter einem Bereich: eine neue Liste oder ein neues Projekt anlegen.
 *
 * Beides wird ein Label im Bereich („privat_einkauf“). Todoist-Projekte legt
 * die App hier nicht an: Der kostenlose Tarif hat nur fünf davon, und die sind
 * belegt.
 */
export function AreaAdd({ area }: { area: string }) {
  const { t } = useT();
  const [mode, setMode] = useState<'list' | 'project' | null>(null);
  const [name, setName] = useState('');
  const list = useCreateList(area, name);
  const busy = list.busy;

  const close = () => { setMode(null); setName(''); };

  async function submit(event: FormEvent) {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed || busy) return;
    if (await list.create()) close();
  }

  if (!mode) {
    return (
      <div className="area-add">
        <button className="navitem area-addbtn" onClick={() => setMode('list')}>{t('area.addList')}</button>
        <button className="navitem area-addbtn" onClick={() => setMode('project')}>{t('area.addProject')}</button>
      </div>
    );
  }

  const invalid = name.trim() !== '' && !list.label;
  return (
    <form className="area-add" onSubmit={submit}>
      <input
        autoFocus
        className="area-addfield"
        value={name}
        placeholder={mode === 'list' ? t('area.listName') : t('area.projectName')}
        aria-invalid={invalid || undefined}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Escape') close(); }}
      />
      <button type="submit" className="navitem area-addbtn" disabled={!name.trim() || busy || invalid}>{t('area.create')}</button>
      <button type="button" className="navitem area-addbtn" onClick={close}>{t('common.cancel')}</button>
    </form>
  );
}
