import { Icon, type IconName } from './Icon';
import { listDisplayName } from '@/domain/lists';

/* The glyph of each kind of list in an area, so the sidebar and the page head
   need no tag marks. */
const LIST_ICON: Record<string, IconName> = {
  eingang: 'inbox',
  wiederholend: 'repeat',
  geplant: 'upcoming',
};

/** The glyph of a list such as „wiederholend“. */
export function ListIcon({ list }: { list: string }) {
  return <Icon name={LIST_ICON[list] ?? 'tag'} />;
}

/**
 * The title of a list page: its plain name and glyph. The label or project
 * behind it (privat_wiederholend) stays out of sight, as it does in the sidebar.
 */
export function ListTitle({ list }: { list: string }) {
  return (
    <span className="ptitle-row">
      <span className="ptitle-icon">
        <span className="ptitle-mark static" aria-hidden="true">
          <span className="hash"><ListIcon list={list} /></span>
        </span>
      </span>
      <span>{listDisplayName(list)}</span>
    </span>
  );
}
