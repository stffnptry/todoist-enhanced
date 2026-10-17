import { useState, type FormEvent } from 'react';
import { useT } from '@/hooks/useT';
import { useCreateList } from '@/hooks/useCreateList';
import { useStore } from '@/store/store';
import type { Project } from '@/domain/types';

/**
 * Unter einem Bereich: eine neue Liste oder ein neues Projekt anlegen.
 *
 * Eine Liste wird ein Label im Bereich („privat_einkauf“), ein Projekt wird
 * ein Todoist-Projekt, das im Ordner des Bereichs liegt.
 */
export function AreaAdd({ area }: { area: Project }) {
  const { t } = useT();
  const createProject = useStore((s) => s.createProject);
  const [mode, setMode] = useState<'list' | 'project' | null>(null);
  const [name, setName] = useState('');
  const list = useCreateList(area.name, name);
  const busy = list.busy;

  const close = () => { setMode(null); setName(''); };

  async function submit(event: FormEvent) {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed || busy) return;
    if (mode === 'list') {
      if (await list.create()) close();
      return;
    }
    if (mode === 'project') {
      await createProject(trimmed, 'charcoal', area.workspace_id ?? null, null, { parentId: area.id });
      close();
    }
  }

  if (!mode) {
    return (
      <div className="area-add">
        <button className="navitem area-addbtn" onClick={() => setMode('list')}>{t('area.addList')}</button>
        <button className="navitem area-addbtn" onClick={() => setMode('project')}>{t('nav.addProject')}</button>
      </div>
    );
  }

  const invalid = mode === 'list' && name.trim() !== '' && !list.label;
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
