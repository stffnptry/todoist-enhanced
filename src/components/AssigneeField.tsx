import { PersonAvatar } from './PersonAvatar';
import { useProjectPeople } from '@/hooks/useProjectPeople';
import { Select } from './Select';
import { Icon } from './Icon';
import { useStore } from '@/store/store';
import { useT } from '@/hooks/useT';
import { assignees } from '@/domain/sharing';
import { assigneeName } from '@/domain/assignees';

export function AssigneeField({ projectId, value, onChange, chip = false, iconOnly = false }: {
  projectId: string; value: string | null; onChange: (value: string | null) => void; chip?: boolean; iconOnly?: boolean;
}) {
  const { t } = useT();
  useProjectPeople(projectId, !iconOnly);
  const snapshot = useStore((state) => state.snapshot);
  const people = assignees(snapshot, projectId);
  if (snapshot.projects[projectId]?.can_assign_tasks === false) {
    /* Wo niemand zugewiesen werden kann (eigene Projekte, Eingang), ist ein
       „Niemand“ nur Lärm: das Feld erscheint nur, wenn doch jemand eingetragen ist. */
    if (!value) return null;
    return iconOnly ? <PersonAvatar id={value} /> : <span className="assignee-readonly">
      <PersonAvatar id={value} decorative />
      {assigneeName(snapshot, value, t('assignee.unavailable'))}
    </span>;
  }
  if (!people.length && !value) return null;
  const missing = value && !people.some((person) => person.id === value);
  return <Select label={chip ? t('detail.assignee') : undefined} ariaLabel={t('detail.assignee')}
    variant={iconOnly ? 'icon' : chip ? 'chip' : 'field'} chipIcon={value ? <PersonAvatar id={value} /> : <Icon name="user" size="sm" />}
    value={value ?? ''} onChange={(id) => onChange(id || null)}
    options={[{ value: '', label: t('detail.unassigned'), visual: <PersonAvatar id={null} decorative /> },
      ...(missing ? [{ value, label: assigneeName(snapshot, value, t('assignee.unavailable')), visual: <PersonAvatar id={value} decorative /> }] : []),
      ...people.map((person) => ({ value: person.id, visual: <PersonAvatar id={person.id} decorative />, label: person.id === snapshot.user?.id ? `${t('assignee.me')} (${person.name})` : person.name }))]} />;
}
