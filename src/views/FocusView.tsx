import { useMemo } from 'react';
import { Icon } from '@/components/Icon';
import { SubtasksProvider, TaskRow } from '@/components/TaskRow';
import { useT } from '@/hooks/useT';
import { useData } from '@/hooks/useData';
import { navigate } from '@/hooks/useRoute';
import { rootItems } from '@/store/selectors';
import { bucketOf } from '@/domain/views';
import { toDisplayPriority, type Item } from '@/domain/types';
import { placementFor, type TaskPlacement } from '@/domain/dnd';

/**
 * How many tasks the focus page offers at once. A short list is easier to
 * start than a long one, and the rest waits one click away on Today.
 */
const FOCUS_LIMIT = 3;

interface FocusViewProps {
  onOpen: (id: string) => void;
  onAddTaskTo: (placement: TaskPlacement) => void;
}

/**
 * A calm start page for a day: a few tasks to begin with, and the overdue ones
 * gathered into one line instead of a red list. Built for attention that
 * wanders, so nothing here asks to be handled all at once.
 */
export function FocusView({ onOpen, onAddTaskTo }: FocusViewProps) {
  const { t } = useT();
  const { items, childrenOf } = useData('focus');

  const { focus, overdueCount, todayCount } = useMemo(() => {
    const today = new Date();
    const open = rootItems(items).filter((item) => !item.checked);
    const due = open.filter((item) => {
      const bucket = bucketOf(item, today);
      return bucket === 'overdue' || bucket === 'today';
    });
    // Overdue first, then the most urgent priority. Ties keep the order the
    // list already had, so the picks do not reshuffle on every render.
    const ordered = [...due].sort((a, b) => rank(a, today) - rank(b, today) || toDisplayPriority(a.priority) - toDisplayPriority(b.priority));
    return {
      focus: ordered.slice(0, FOCUS_LIMIT),
      overdueCount: due.filter((item) => bucketOf(item, today) === 'overdue').length,
      todayCount: due.filter((item) => bucketOf(item, today) === 'today').length,
    };
  }, [items]);

  return (
    <div className="focus-view">
      <header className="focus-head">
        <h1>{t('focus.title')}</h1>
        <p className="focus-hint">{t('focus.hint')}</p>
      </header>

      <section className="focus-now" aria-labelledby="focus-now-heading">
        <h2 id="focus-now-heading">{t('focus.now')}</h2>
        {focus.length === 0 ? (
          <p className="focus-empty">{t('focus.empty')}</p>
        ) : (
          <SubtasksProvider value={false}>
            <ul className="focus-list">
              {focus.map((item) => (
                <li key={item.id}>
                  <TaskRow item={item} childrenOf={childrenOf} onOpen={onOpen} />
                </li>
              ))}
            </ul>
          </SubtasksProvider>
        )}
        <button className="btn" onClick={() => onAddTaskTo(placementFor({ kind: 'today' }))}>
          <Icon name="plus" size="sm" />
          <span>{t('focus.add')}</span>
        </button>
      </section>

      <section className="focus-rest" aria-label={t('focus.restLabel')}>
        <p>{t('focus.todayCount', { count: todayCount })}</p>
        {overdueCount > 0 && (
          <div className="focus-overdue">
            <p>{t('focus.overdue', { count: overdueCount })}</p>
            <button className="btn" onClick={() => navigate('today')}>{t('focus.replan')}</button>
          </div>
        )}
      </section>
    </div>
  );
}

/** Overdue tasks rank ahead of tasks due today; anything else sorts last. */
const rank = (item: Item, now: Date): number => (bucketOf(item, now) === 'overdue' ? 0 : 1);
