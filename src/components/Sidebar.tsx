import { addDays, endOfDay } from 'date-fns';
import { dueDate } from '@/domain/dates';
import { viewPrefs } from '@/store/prefs';
import { assigneeItems } from '@/domain/assignees';
import { datedRoots, childIndex, makeChildrenOf, openItems, applyFilters } from '@/store/selectors';
import { useFilterCounts } from '@/hooks/useFilterResult';
import { FilterMark } from './FilterMark';
import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Icon, type IconName } from './Icon';
import { useT } from '@/hooks/useT';
import { AreaListSheet } from './overlays/AreaListSheet';
import { useConfirm } from './overlays/Confirm';
import { PageMenu } from './PageMenu';
import { ListIcon } from './ListTitle';
import { useData } from '@/hooks/useData';
import { useStore } from '@/store/store';
import { navigate, type Route } from '@/hooks/useRoute';
import { projectCounts, projectTree, rootItems, type ProjectNode } from '@/store/selectors';
import { bucketOf, missingEstimate, restOfWeekItems, hasLabel, somedayItems, upcomingItems, weekItems } from '@/domain/views';
import { markerStyle, avatarUrl } from '@/domain/colors';
import { firstName, karmaStanding } from '@/domain/karma';
import { readProjectIcon } from '@/domain/projectIcons';
import { ProjectIcon } from './ProjectIconPicker';
import type { ViewId } from '@/domain/types';
import type { DropTarget } from '@/domain/dnd';
import type { TranslationKey } from '@/i18n';
import { SyncStatus } from './SyncStatus';
import { Droppable } from './dnd/Droppable';
import { ProjectDropRow, ProjectRowSortable } from './dnd/ProjectRowSortable';
import { COFFEE_URL } from '@/app-info';
import { Feedback } from './overlays/Feedback';
import { ProjectMenu } from './ProjectMenu';
import { DraggableTag } from './dnd/DraggableTag';
import { dragClock } from './dnd/DragProvider';
import type { ProjectSheetTarget } from './overlays/ProjectSheet';
import { byChildOrder, byLabelOrder } from '@/domain/orderKey';
import { visibleSidebarNav, type SidebarItemId } from '@/domain/sidebar';
import { pointAnchor } from '@/lib/contextMenu';
import { isHiddenLabel } from '@/domain/kanban';
import { areaTitle, compareLists, listDisplayName, parseListLabel, splitListName, type ListLabel, type ListMeta } from '@/domain/lists';

interface SidebarProps {
  route: Route;
  onAddTask: () => void;
  onSearch: () => void;
  onIssues: () => void;
  /** Opens the project sheet, to create one here or to edit that one. */
  onProjectSheet: (target: ProjectSheetTarget) => void;
  issuesCount: number;
  /**
   * 'rail' is the column beside the app. 'sheet' is the same thing shown as a
   * page on a phone, where there is no room for a column: it ignores the
   * collapsed preference, which belongs to the rail, and drops the control
   * that sets it.
   */
  variant?: 'rail' | 'sheet';
}

/**
 * The keys that reach each destination, for the hint a row shows when the
 * pointer rests on it. Kept beside the rows rather than imported from the
 * keyboard, because this is the label on a button and not the binding itself —
 * and a label that has drifted from its key is worse than no label.
 */
const GO_KEYS: Partial<Record<ViewId, string>> = {
  inbox: 'I',
  today: 'T',
  week: 'W',
  upcoming: 'U',
  someday: 'S',
  review: 'R',
  labels: 'L',
};

/** How long the pointer has to actually stay on a row before it is told. */
const HINT_DELAY_MS = 550;

export function Sidebar({
  route, onAddTask, onSearch, onIssues, onProjectSheet, issuesCount, variant = 'rail',
}: SidebarProps) {
  const { t } = useT();
  const { snapshot, items } = useData();
  const prefs = useStore((state) => state.prefs);
  const sheet = variant === 'sheet';
  const collapsed = useStore((s) => s.prefs.sidebarCollapsed) && !sheet;
  const setPrefs = useStore((s) => s.setPrefs);
  const weekLayout = useStore((s) => s.prefs.weekLayout);
  const eisenhowerEnabled = useStore((s) => s.prefs.eisenhowerEnabled);
  const sidebarNav = useStore((s) => s.prefs.sidebarNav);
  const showSearch = useStore((s) => s.prefs.sidebarSearch);
  const showCounts = useStore((s) => s.prefs.sidebarCounts);
  const disconnect = useStore((s) => s.disconnect);
  const draggingProjectId = useStore((s) => s.draggingProjectId);
  const [menuOpen, setMenuOpen] = useState(false);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const [openFolders, setOpenFolders] = useState<Record<string, boolean>>({});
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});
  /** The project row whose action menu is open, and the button it hangs from. */
  const [rowMenu, setRowMenu] = useState<{ key: string; anchor: HTMLElement } | null>(null);

  /**
   * The shortcut pill, drawn beside the row rather than inside it.
   *
   * Inside it, the only free space is the count's, and taking that away to
   * show the key hid the number the row is mostly there for — under the
   * pointer, which is where the pointer already was. It goes in the document,
   * clear of the sidebar's own scrolling box, which clips anything hanging
   * over its edge.
   */
  const [hint, setHint] = useState<{ top: number; left: number; key: string } | null>(null);
  const hintTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const hideHint = () => {
    if (hintTimer.current) clearTimeout(hintTimer.current);
    hintTimer.current = null;
    setHint(null);
  };

  const showHint = (row: HTMLElement, key?: string) => {
    hideHint();
    if (!key) return;
    // No pointer to rest anywhere, and no room beside the row either.
    if (!window.matchMedia('(hover: hover)').matches) return;
    hintTimer.current = setTimeout(() => {
      const box = row.getBoundingClientRect();
      setHint({ top: Math.round(box.top + box.height / 2), left: Math.round(box.right + 8), key });
    }, HINT_DELAY_MS);
  };

  useEffect(() => hideHint, []);

  const roots = useMemo(() => rootItems(items), [items]);
  const inboxId = snapshot.user?.inbox_project_id;

  const counts = useMemo(() => {
    const now = new Date();
    const scope = (key: string) => {
      const filters = viewPrefs(prefs, key).filters;
      const scoped = { ...snapshot, items: assigneeItems(snapshot, filters.assignees) };
      const list = ['today', 'week', 'upcoming'].includes(key) ? datedRoots(openItems(scoped), scoped) : rootItems(openItems(scoped));
      return applyFilters(list, filters, snapshot, makeChildrenOf(childIndex(scoped)));
    };
    return {
      inbox: inboxId ? scope('inbox').filter((i) => i.project_id === inboxId).length : 0,
      today: scope('today').filter((i) => {
        const bucket = bucketOf(i, now);
        return bucket === 'overdue' || bucket === 'today';
      }).length,
      /* The count has to match the page. A "My week" that no longer contains
         today must not keep counting today's work. */
      week: (weekLayout === 'split' ? restOfWeekItems(scope('week'), now) : weekItems(scope('week'), now)).length,
      upcoming: upcomingItems(scope('upcoming')).filter((item) => {
        const date = dueDate(item);
        return date !== null && date <= endOfDay(addDays(now, prefs.upcomingHorizonDays));
      }).length,
      someday: somedayItems(scope('someday')).length,
      unestimated: (() => {
        /* Wie die Seite: alle offenen Aufgaben, Unteraufgaben mitgezählt. */
        const filters = viewPrefs(prefs, 'unestimated').filters;
        const scoped = { ...snapshot, items: assigneeItems(snapshot, filters.assignees) };
        const childrenOf = makeChildrenOf(childIndex(scoped));
        const open = openItems(scoped);
        const { ids } = missingEstimate(open, childrenOf);
        return applyFilters(open.filter((i) => ids.has(i.id)), filters, snapshot, childrenOf).length;
      })(),
      byProject: projectCounts(roots),
    };
  }, [roots, inboxId, weekLayout, snapshot, prefs]);

  /** Favourites are Todoist's own star, not a separate list this app keeps. */
  const favourites = useMemo(() => {
    const labels = Object.values(snapshot.labels)
      .filter((l) => l.is_favorite && !isHiddenLabel(l.name))
      .sort(byLabelOrder);
    const projects = Object.values(snapshot.projects)
      .filter((p) => p.is_favorite && !p.is_archived && !p.is_deleted)
      .sort(byChildOrder);
    const filters = Object.values(snapshot.filters ?? {})
      .filter((f) => f.is_favorite && !f.is_deleted)
      .sort(byLabelOrder);
    return { labels, projects, filters };
  }, [snapshot.labels, snapshot.projects, snapshot.filters]);
  const filterCounts = useFilterCounts(favourites.filters);

  /*
   * The Bereiche as drawn: each holds its lists. A list is a label (privat_geplant)
   * or, on Todoist's free plan, a project (Claude_Eingang). Both show here by their
   * plain names and are hidden from the other sections.
   */
  const listMeta = useStore((s) => s.prefs.listMeta);
  const areas = useMemo(() => {
    type Row = { key: string; list: string; name: string; color: string; view: ViewId; id: string; meta?: ListMeta; labelId?: string };
    const byArea = new Map<string, Row[]>();
    const add = (parts: ListLabel, row: Row) => {
      byArea.set(parts.area, [...(byArea.get(parts.area) ?? []), row]);
    };
    for (const label of Object.values(snapshot.labels)) {
      /* Die festen Listen (privat_geplant) und selbst angelegte (privat_einkauf). */
      const parts = label.is_deleted ? null : splitListName(label.name) ?? parseListLabel(label.name);
      const meta = listMeta[label.name];
      if (parts) add(parts, { key: `label-${label.name}`, list: parts.list, name: meta?.name ?? listDisplayName(parts.list), color: label.color, view: 'label', id: label.name, meta, labelId: label.id });
    }
    for (const project of Object.values(snapshot.projects)) {
      const parts = project.is_archived || project.is_deleted ? null : splitListName(project.name);
      if (parts) add(parts, { key: `project-${project.id}`, list: parts.list, name: listDisplayName(parts.list), color: project.color, view: 'project', id: project.id });
    }
    const rank = (area: string) => ['privat', 'arbeit', 'claude'].indexOf(area) + 1 || 99;
    return [...byArea.entries()]
      .sort(([a], [b]) => rank(a) - rank(b) || a.localeCompare(b))
      .map(([area, rows]) => ({
        area,
        rows: [...rows].sort(compareLists),
      }));
  }, [snapshot.labels, snapshot.projects, listMeta]);

  /* A menu that only closes by pressing its own button is a menu that follows
     you around the app. Anywhere else, and Escape, put it away. */
  useEffect(() => {
    if (!menuOpen) return;
    const dismiss = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenuOpen(false);
    };
    document.addEventListener('mousedown', dismiss);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', dismiss);
      document.removeEventListener('keydown', onKey);
    };
  }, [menuOpen]);

  const toggleGroup = (key: string) =>
    setOpenGroups((prev) => ({ ...prev, [key]: !(prev[key] ?? true) }));

  /*
   * Eine Liste löschen heißt: ihr Label löschen. Todoist nimmt es dabei von den
   * Aufgaben, die Aufgaben selbst bleiben (ohne Liste) erhalten.
   */
  const confirm = useConfirm();
  const deleteLabel = useStore((s) => s.deleteLabel);
  async function deleteList(labelId: string, labelName: string, name: string) {
    const count = roots.filter((i) => hasLabel(i, labelName)).length;
    const yes = await confirm({
      title: t('area.deleteTitle', { name }),
      body: count === 0 ? t('area.deleteBodyEmpty') : t('area.deleteBody', { count }),
      confirmLabel: t('area.deleteList'),
      destructive: true,
    });
    if (!yes) return;
    if (route.view === 'label' && route.id === labelName) navigate('week');
    const { [labelName]: _gone, ...rest } = useStore.getState().prefs.listMeta;
    setPrefs({ listMeta: rest });
    await deleteLabel(labelId);
  }

  /* The area whose "+" was pressed; the dialog for a new list in it is open while set. */
  const [addingArea, setAddingArea] = useState<string | null>(null);

  const workspaceOrder = useStore((s) => s.prefs.workspaceOrder);
  const workspaces = useMemo(() => projectTree(snapshot, workspaceOrder), [snapshot, workspaceOrder]);
  const user = snapshot.user;
  const avatar = avatarUrl(user);
  const karma = karmaStanding(user?.karma);
  const initials = (user?.full_name ?? '?')
    .split(' ').map((p) => p[0]).slice(0, 2).join('').toUpperCase();

  const navItem = (
    view: ViewId,
    icon: IconName,
    labelKey: TranslationKey,
    count: number,
    dropTarget?: DropTarget,
    /* Dashboard and Logbook are two entries of the one insights route. */
    page?: { id?: string; current: boolean },
  ) => {
    const button = (isOver: boolean) => (
      <button
        className={`navitem${isOver ? ' dropping' : ''}`}
        data-tour={view === 'week' ? 'week' : view === 'someday' ? 'someday' : view === 'review' ? 'review' : view === 'matrix' ? 'matrix' : view === 'filters' ? 'filters' : labelKey === 'nav.dashboard' ? 'dashboard' : labelKey === 'insights.logbook' ? 'logbook' : undefined}
        aria-current={(page ? page.current : route.view === view) ? 'page' : undefined}
        /* The key that gets here, once the pointer has actually rested on the
           row. Nobody goes looking for a shortcuts sheet, and a hint that
           appears the instant you pass over a row is a column of flashing
           labels down the side of the page. */
        onMouseEnter={(event) => showHint(event.currentTarget, GO_KEYS[view])}
        onMouseLeave={hideHint}
        onFocus={(event) => showHint(event.currentTarget, GO_KEYS[view])}
        onBlur={hideHint}
        onClick={() => navigate(view, page?.id)}
      >
        <Icon name={icon} />
        <span className="label">{t(labelKey)}</span>
        {showCounts && count > 0 && <span className="count">{count}</span>}
      </button>
    );
    if (!dropTarget) return button(false);
    return <Droppable target={dropTarget} scope="nav">{({ isOver }) => button(isOver)}</Droppable>;
  };

  const tagItem = (name: string, color: string, count?: number) => (
    <Droppable
      target={{ kind: 'label', label: name }}
      scope="nav"
      key={`tag-${name}`}
    >
      {({ isOver }) => (
        <DraggableTag name={name}>
        <button
          className={`navitem tagitem${isOver ? ' dropping' : ''}`}
          aria-current={route.view === 'label' && route.id === name ? 'page' : undefined}
          onClick={() => navigate('label', name)}
        >
          <Icon name="tag" className="taglabel" style={markerStyle(color, false)} />
          <span className="label">{name}</span>
          {showCounts && count !== undefined && count > 0 && <span className="count">{count}</span>}
        </button>
        </DraggableTag>
      )}
    </Droppable>
  );

  const visibleNav = visibleSidebarNav(sidebarNav, {
    splitToday: weekLayout !== 'unified',
    matrix: eisenhowerEnabled,
    calendar: Boolean(window.enhancedDesktop?.calendar),
  });
  const insightsOnLogbook = route.view === 'insights' && route.id === 'logbook';

  /** One entry of the nav, by id; the order and the switches are the user's. */
  const navEntry = (id: SidebarItemId): JSX.Element => {
    switch (id) {
      case 'inbox':
        // Dropping on Inbox means filing there, which is a plain project move.
        return navItem('inbox', 'inbox', 'nav.inbox', counts.inbox,
          inboxId ? { kind: 'project', projectId: inboxId } : undefined);
      case 'focus': return navItem('focus', 'deadline', 'nav.focus', 0);
      case 'today': return navItem('today', 'calendar', 'nav.today', counts.today, { kind: 'today' });
      case 'week': return navItem('week', 'week', 'nav.week', counts.week, { kind: 'anytime' });
      case 'upcoming': return navItem('upcoming', 'upcoming', 'nav.upcoming', counts.upcoming);
      case 'someday': return navItem('someday', 'someday', 'nav.someday', counts.someday, { kind: 'someday' });
      case 'unestimated': return navItem('unestimated', 'clock', 'nav.unestimated', counts.unestimated);
      case 'review': return navItem('review', 'check', 'nav.review', 0);
      case 'calendar': return navItem('calendar', 'calendar', 'nav.calendar', 0);
      case 'dashboard':
        return navItem('insights', 'trend', 'nav.dashboard', 0, undefined,
          { current: route.view === 'insights' && !insightsOnLogbook });
      case 'logbook':
        return navItem('insights', 'tasks', 'insights.logbook', 0, undefined,
          { id: 'logbook', current: insightsOnLogbook });
      case 'report': return navItem('report', 'file', 'nav.report', 0);
      case 'matrix': return navItem('matrix', 'dashboard', 'nav.matrix', 0);
      case 'labels': return navItem('labels', 'tag', 'nav.labels', 0);
      case 'filters':
        return navItem('filters', 'filter', 'nav.filters', 0, undefined,
          { current: route.view === 'filters' || route.view === 'filter' });
    }
  };
  const navBlock = (ids: SidebarItemId[]) => ids.map((id) => <Fragment key={id}>{navEntry(id)}</Fragment>);

  /** A project row, or a folder that discloses the projects inside it. */
  const projectNode = (node: ProjectNode, keyPrefix = '', depth = 0): JSX.Element => {
    const { project, children } = node;

    if (project.is_folder) {
      const isOpen = openFolders[project.id] ?? true;
      return (
        <div key={`${keyPrefix}folder-${project.id}`}>
          {/* A folder takes a project dropped on it, which is the only thing a
              folder is for and was the one place in the sidebar you could not
              drag a project into. */}
          <ProjectDropRow projectId={project.id}>
            <button
              className="navitem folderitem"
              data-tour="folder"
              aria-expanded={isOpen}
              onClick={() => setOpenFolders((prev) => ({ ...prev, [project.id]: !isOpen }))}
            >
              <Icon name="project" />
              <span className="label">{project.name}</span>
              <Icon name={isOpen ? 'caret-up' : 'caret'} size="sm" className="disclose" />
            </button>
          </ProjectDropRow>
          {isOpen && children.map((child) => projectNode(child, keyPrefix, depth + 1))}
        </div>
      );
    }

    const rowKey = `${keyPrefix}${project.id}`;
    const count = counts.byProject.get(project.id) ?? 0;
    const folderLike = children.length > 0 && count === 0;
    const menuOpen = rowMenu?.key === rowKey;
    const childrenOpen = openFolders[project.id] ?? true;
    const customIcon = readProjectIcon(project.description);

    const row = (
      <Droppable
        target={{ kind: 'project', projectId: project.id }}
        /* A favourite project also appears under its workspace, so the two
           rows must not claim the same droppable id. */
        scope={`nav-${keyPrefix || 'tree'}`}
        /* The other half of the same rule the row itself follows: while a
           project is being dragged the row is a position in a list, not a
           place to file anything, so the destination stands down and the
           reorder bar is the only thing the drag can land on. */
        disabled={draggingProjectId !== null}
        key={rowKey}
      >
        {({ isOver }) => (
          /* A row, not a button: the actions live beside the destination and a
             button cannot legally contain another one. */
          <ProjectRowSortable
            projectId={project.id}
            sortable={keyPrefix === ''}
            className={`${folderLike ? ' folderlike' : ''}${menuOpen ? ' menuopen' : ''}`}
            /* Held under a finger, the row itself is the anchor: the button
               this menu usually hangs from is not on the page on a phone. */
            onPressHold={(node) => setRowMenu(menuOpen ? null : { key: rowKey, anchor: node })}
            onContextMenu={(event) => {
              event.preventDefault();
              setRowMenu({ key: rowKey, anchor: pointAnchor(event) });
            }}
          >
            <button
              className={`navitem${folderLike ? ' folderitem' : ''}${isOver ? ' dropping' : ''}`}
              data-tour={folderLike ? 'folder' : customIcon ? 'project-icon' : undefined}
              style={depth > 0 ? { paddingLeft: `${8 + depth * 16}px` } : undefined}
              aria-current={route.view === 'project' && route.id === project.id ? 'page' : undefined}
              /* A press that has just been held is a press that has just done
                 something — opened this menu, or carried the row somewhere —
                 and the click the browser sends afterwards is not a second
                 instruction to go to the project. */
              onClick={() => { if (!dragClock.justEnded()) navigate('project', project.id); }}
            >
              {folderLike
                ? <Icon name="project" />
                : (
                  <span className="hash" style={markerStyle(project.color)}>
                    {customIcon
                      ? <ProjectIcon iconId={customIcon} size="sm" style={{ color: 'inherit' }} />
                      : '#'}
                  </span>
                )}
              <span className="label">{project.name}</span>
            </button>

            {/* The count gives up its place to the actions under the pointer,
                which is where Todoist puts them and where the eye looks. */}
            <span className="navend">
              {showCounts && count > 0 && <span className="count">{count}</span>}
              <button
                className="navmore"
                aria-label={t('project.actions')}
                title={t('project.actions')}
                aria-expanded={menuOpen}
                aria-haspopup="menu"
                onClick={(event) =>
                  setRowMenu(menuOpen ? null : { key: rowKey, anchor: event.currentTarget })}
              >
                <Icon name="more" size="sm" />
              </button>
            </span>

            {/* A project that holds projects discloses them, the way a folder
                does. Without this its children were built, counted, and never
                drawn: nested projects simply were not in the sidebar. */}
            {children.length > 0 && (
              <button
                className={`navtwist${folderLike ? ' foldertoggle' : ''}`}
                aria-expanded={childrenOpen}
                aria-label={project.name}
                onClick={() => setOpenFolders((prev) => ({ ...prev, [project.id]: !childrenOpen }))}
              >
                <Icon name={childrenOpen ? 'caret-up' : 'caret'} size="sm" />
              </button>
            )}

            {menuOpen && (
              <ProjectMenu
                project={project}
                anchor={rowMenu?.anchor ?? null}
                onClose={() => setRowMenu(null)}
                onEdit={() => onProjectSheet({ mode: 'edit', projectId: project.id })}
                /* Only in the tree. A favourite is the same project shown a
                   second time, and "above" and "below" name positions in the
                   list it actually lives in, not in this one. */
                onAddAbove={keyPrefix !== '' ? undefined : () => onProjectSheet({
                  mode: 'create',
                  workspaceId: project.workspace_id ?? null,
                  anchor: { siblingId: project.id, position: 'above' },
                })}
                onAddBelow={keyPrefix !== '' ? undefined : () => onProjectSheet({
                  mode: 'create',
                  workspaceId: project.workspace_id ?? null,
                  anchor: { siblingId: project.id, position: 'below' },
                })}
              />
            )}
          </ProjectRowSortable>
        )}
      </Droppable>
    );

    if (children.length === 0) return row;
    return (
      <div key={`${rowKey}-tree`}>
        {row}
        {childrenOpen && children.map((child) => projectNode(child, keyPrefix, depth + 1))}
      </div>
    );
  };

  return (
    <>
    <Feedback open={feedbackOpen} onClose={() => setFeedbackOpen(false)} />
    <AreaListSheet area={addingArea} onClose={() => setAddingArea(null)} />
    {/* Folded, the sidebar is still here and still drawn: it slides out
        (theme.css), and `inert` takes it out of the tab order and out of reach
        of a screen reader while it is away. */}
    <aside
      className={`sidebar${sheet ? ' sidebar-sheet' : ''}`}
      // React 18's types do not know `inert` yet; the browser does.
      {...({ inert: collapsed ? '' : undefined } as object)}
      aria-hidden={collapsed || undefined}
    >
      <div className="side-top" ref={menuRef}>
        <button
          className="profile"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((v) => !v)}
        >
          <span className="avatar">
            {avatar
              ? <img src={avatar} alt="" width={30} height={30} referrerPolicy="no-referrer" />
              : initials}
          </span>
          <span className="identity">
            <strong>{firstName(user?.full_name)}</strong>
            {karma ? (
              <span className="karma" title={t('karma.progress', {
                remaining: karma.remaining ?? 0,
                next: karma.next ? t(`karma.${karma.next.key}` as TranslationKey) : '',
              })}>
                <small>{t(`karma.${karma.rank.key}` as TranslationKey)}</small>
                <span className="karmabar" aria-hidden="true">
                  <i style={{ width: `${karma.progress}%` }} />
                </span>
              </span>
            ) : (
              <small>{user?.email ?? ''}</small>
            )}
          </span>
          <Icon name="caret" size="sm" />
        </button>

        {/* Notifications and conflicts, one door. The dot says there is
            something behind it, and says nothing about how much. */}
        <button
          className="iconbtn bellbtn"
          data-tour="notifications"
          aria-label={t('issues.title')}
          title={t('issues.title')}
          onClick={onIssues}
        >
          <Icon name="bell" />
          {issuesCount > 0 && <span className="belldot" aria-hidden="true" />}
        </button>
        {!sheet && (
          <button
            className="iconbtn"
            aria-label={t('nav.collapseSidebar')}
            title={t('nav.collapseSidebar')}
            onClick={() => setPrefs({ sidebarCollapsed: true })}
          >
            <Icon name="sidebar" />
          </button>
        )}

        {menuOpen && (
          <div className="menu" style={{ display: 'block' }}>
            <button onClick={() => { setMenuOpen(false); navigate('settings'); }}>
              <Icon name="settings" />
              {t('nav.settings')}
            </button>
            <button onClick={() => { setMenuOpen(false); window.dispatchEvent(new Event('enhanced:changelog')); }}>
              <Icon name="sparkles" />
              {t('nav.whatsNew')}
            </button>
            <button onClick={() => { setMenuOpen(false); setFeedbackOpen(true); }}>
              <Icon name="comment" />
              {t('nav.feedback')}
            </button>
            <button onClick={() => window.open(COFFEE_URL, '_blank', 'noopener,noreferrer')}>
              <Icon name="coffee" />
              {t('nav.coffee')}
            </button>
            <hr />
            <button onClick={() => window.open('https://app.todoist.com', '_blank', 'noopener')}>
              <Icon name="external" />
              {t('nav.openTodoist')}
            </button>
            <button className="danger" onClick={() => { setMenuOpen(false); void disconnect(); }}>
              <Icon name="logout" />
              {t('nav.signOut')}
            </button>
          </div>
        )}
      </div>

      <div className="side-scroll">
        {showSearch && (
          <button className="searchbtn" onClick={onSearch}>
            <Icon name="search" />
            <span>{t('nav.search')}</span>
            <kbd>⌘K</kbd>
          </button>
        )}
        {/* Planning with Claude: only the desktop app can reach the Claude CLI. */}
        {window.enhancedDesktop?.claude && (
          /* A menu entry like the others, a little apart from them; it reads
             as selected only while Claude's panel is open (html.claude-open). */
          <button className="navitem claudenav" onClick={() => window.dispatchEvent(new CustomEvent('enhanced:toggle-claude'))}>
            <Icon name="sparkles" />
            <span className="label">{t('claude.open')}</span>
            <kbd className="navkbd">⌘J</kbd>
          </button>
        )}

        <nav aria-label={t('nav.projects')}>
          {navBlock(visibleNav.main)}
          {visibleNav.main.length > 0 && visibleNav.other.length > 0 && <div className="nav-gap" />}
          {navBlock(visibleNav.other)}
        </nav>

        {(favourites.labels.length > 0 || favourites.projects.length > 0 || favourites.filters.length > 0) && (
          <SideGroup
            title={t('nav.favourites')}
            open={openGroups.favourites ?? true}
            onToggle={() => toggleGroup('favourites')}
            /* The whole section, not its heading: "put this in there" is
               aimed at the box, and asking for the one line of text at the
               top of it is a target you have to be told about. */
            dropTarget={{ kind: 'favourites' }}
          >
            {favourites.projects.map((p) =>
              projectNode({ project: p, children: [] }, 'fav-'))}
            {favourites.labels.map((l) =>
              tagItem(l.name, l.color, roots.filter((i) => hasLabel(i, l.name)).length))}
            {/* The count is Todoist's answer to the query, asked again when
                the tasks change; it shows once Todoist has answered. */}
            {favourites.filters.map((f) => (
              <button
                key={`filter-${f.id}`}
                className="navitem tagitem"
                aria-current={route.view === 'filter' && route.id === f.id ? 'page' : undefined}
                onClick={() => navigate('filter', f.id)}
              >
                <FilterMark filter={f} className="taglabel" style={markerStyle(f.color, false)} />
                <span className="label">{f.name}</span>
                {showCounts && (filterCounts[f.id] ?? 0) > 0 && <span className="count">{filterCounts[f.id]}</span>}
              </button>
            ))}
          </SideGroup>
        )}

        {areas.map(({ area, rows }) => {
          const key = `area-${area}`;
          return (
            <SideGroup
              key={key}
              title={areaTitle(area)}
              open={openGroups[key] ?? true}
              onToggle={() => toggleGroup(key)}
              onAdd={() => setAddingArea(area)}
              addLabel={t('area.add')}
            >
              {rows.map((row) => {
                const button = (
                  <button
                    key={row.key}
                    className="navitem"
                    aria-current={route.view === row.view && route.id === row.id ? 'page' : undefined}
                    onClick={() => navigate(row.view, row.id)}
                  >
                    <ListIcon list={row.list} meta={row.meta} />
                    <span className="label">{row.name}</span>
                  </button>
                );
                /* Nur Listen aus Labels lassen sich hier löschen: Eine Liste,
                   die ein Todoist-Projekt ist (Claude_Eingang), nähme ihre
                   Aufgaben mit. */
                const labelId = row.labelId;
                if (!labelId) return button;
                return (
                  <div key={row.key} className="navrow arearow">
                    {button}
                    <span className="navend">
                      <PageMenu
                        floating
                        label={t('area.listActions')}
                        contextOn=".arearow"
                        items={[{
                          key: 'delete', label: t('area.deleteList'), icon: 'trash', danger: true,
                          onPick: () => void deleteList(labelId, row.id, row.name),
                        }]}
                      />
                    </span>
                  </div>
                );
              })}
            </SideGroup>
          );
        })}

        {workspaces.map((workspace) => {
          const key = workspace.workspaceId ?? 'personal';
          const projects = workspace.roots.filter((node) => !splitListName(node.project.name));
          /* On the personal workspace the lists are the content; an empty "Meine
             Projekte" heading under them is noise. Team workspaces keep theirs. */
          if (!workspace.workspaceId && projects.length === 0) return null;
          return (
            <SideGroup
              key={key}
              title={workspace.name ?? t('nav.myProjects')}
              logo={workspace.workspaceId ? snapshot.workspaces[workspace.workspaceId]?.logo_big ?? null : null}
              open={openGroups[key] ?? true}
              onToggle={() => toggleGroup(key)}
              onAdd={() => onProjectSheet({
                mode: 'create',
                workspaceId: workspace.workspaceId,
              })}
              addLabel={t('nav.addProject')}
            >
              {workspace.roots.length > 0
                ? projects.map((node) => projectNode(node))
                : <p className="side-empty">{t('nav.noProjectsYet')}</p>}
            </SideGroup>
          );
        })}
      </div>

      <div className="side-foot">
        <button className="addbtn" onClick={onAddTask}>
          {t('nav.addTask')}
          <Icon name="plus" />
        </button>
        <div className="footrow">
          <SyncStatus />
        </div>
            </div>

      {hint && createPortal(
        <span className="gohint" style={{ top: hint.top, left: hint.left }} role="presentation">
          <kbd>G</kbd>
          <small>{t('keys.then')}</small>
          <kbd>{hint.key}</kbd>
        </span>,
        document.body,
      )}
    </aside>
    {collapsed && (
      <div className="expand-wrap">
        <button
          className="iconbtn"
          aria-label={t('nav.showSidebar')}
          title={t('nav.showSidebar')}
          onClick={() => setPrefs({ sidebarCollapsed: false })}
        >
          <Icon name="sidebar" />
        </button>
      </div>
    )}
    </>
  );
}

/**
 * A titled block of the sidebar.
 *
 * The heading discloses its contents from a caret on the right, matching the
 * folders below it, and the add button only appears under the pointer so the
 * resting sidebar stays quiet.
 */
function SideGroup({
  title, logo, open, onToggle, onAdd, addLabel, dropTarget, children,
}: {
  title: string;
  /** A workspace's own picture, when Todoist has one. */
  logo?: string | null;
  open: boolean;
  onToggle: () => void;
  onAdd?: () => void;
  addLabel?: string;
  /** When set, the heading itself takes a drop. */
  dropTarget?: DropTarget;
  children: React.ReactNode;
}) {
  const head = () => (
    <div className="side-head">
        <button className="side-headbtn" aria-expanded={open} onClick={onToggle}>
          {logo && <img className="side-logo" src={logo} alt="" referrerPolicy="no-referrer" onError={(e) => { e.currentTarget.style.display = 'none'; }} />}
          <span>{title}</span>
        </button>
        {onAdd && (
          <button
            className="side-add"
            aria-label={addLabel}
            title={addLabel}
            onClick={onAdd}
          >
            <Icon name="plus" size="sm" />
          </button>
        )}
        {/* The caret ends the row, where every other disclosure in the app
            puts it; the add button sits just inside it. */}
        <button
          className="side-disclose"
          aria-expanded={open}
          aria-label={title}
          onClick={onToggle}
        >
          <Icon name={open ? 'caret-up' : 'caret'} size="sm" />
        </button>
    </div>
  );

  const body = (isOver: boolean) => (
    <section className={`side-group${isOver ? ' dropping' : ''}`}>
      {head()}
      {open && children}
    </section>
  );

  if (!dropTarget) return body(false);
  return (
    <Droppable target={dropTarget} scope="side-group">
      {({ isOver }) => body(isOver)}
    </Droppable>
  );
}
