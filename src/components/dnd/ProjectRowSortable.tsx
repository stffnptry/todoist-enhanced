import { useEffect, useRef, type ReactNode } from 'react';
import { useDndContext, useDraggable, useDroppable } from '@dnd-kit/core';
import { useStore } from '@/store/store';

interface ProjectRowSortableProps {
  projectId: string;
  className?: string;
  /**
   * False for the copy of a project shown under Favourites.
   *
   * A favourite is the same project appearing twice, and two rows cannot
   * register the same drag id — the second silently replaces the first. The
   * copy is also not in a list of its own to be reordered within: its order
   * there is the tree's order.
   */
  sortable?: boolean;
  /**
   * Pressed and held without moving — a finger asking the row what it can do.
   * On a phone this is the project menu; a mouse has the three-dot button.
   * The row hands over its own element, because on a phone it is what the
   * menu has to be placed against: the button it usually hangs from is not
   * on the page.
   */
  onPressHold?: (row: HTMLElement) => void;
  /** Rechtsklick auf die Zeile: öffnet dasselbe Menü wie die drei Punkte. */
  onContextMenu?: (event: React.MouseEvent<HTMLElement>) => void;
  children: ReactNode;
}

/** The id a sidebar project row registers under, in both roles. */
export const projectRowId = (projectId: string): string => `project-row:${projectId}`;
export const projectSlotId = (projectId: string, position: 'before' | 'after'): string =>
  `project-slot:${projectId}:${position}`;

/**
 * How a row is found in the document, and what it is told.
 *
 * The press that opens a project's menu is recognised where every other drag
 * is read — at the end of the drag, by the provider — and the row it belongs
 * to is a DOM node long before it is a component. Telling it directly is one
 * message to one row; a context would tell forty rows that one of them had
 * been pressed.
 */
export const projectRowAttr = 'data-project-row';
export const PRESS_HOLD_EVENT = 'enhanced:presshold';

/**
 * A sidebar project row that can be picked up and put down on another.
 *
 * It registers in the app's one drag context rather than opening a second: a
 * nested context would fight the first over the same pointer, and dropping a
 * task onto a project has to keep working while a project is being dragged
 * past it. The row is both a handle and a landing place, which is what makes
 * reordering feel like moving one thing rather than aiming at a gap.
 *
 * The drag starts after a short distance, so a click still selects the
 * project and a project is never reordered by accident.
 */
export function ProjectRowSortable({
  projectId, className = '', sortable = true, onPressHold, onContextMenu, children,
}: ProjectRowSortableProps) {
  const id = projectRowId(projectId);
  const rowRef = useRef<HTMLDivElement | null>(null);
  const hold = useRef(onPressHold);
  hold.current = onPressHold;

  useEffect(() => {
    const row = rowRef.current;
    if (!row) return;
    const fire = () => hold.current?.(row);
    row.addEventListener(PRESS_HOLD_EVENT, fire);
    return () => row.removeEventListener(PRESS_HOLD_EVENT, fire);
  }, []);
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id, disabled: !sortable });
  /* A task in flight is not looking for a position in this list, it is looking
     for a project to live in — and that destination is the droppable wrapped
     around this row. Both used to stay open, the pointer landed on whichever
     of the two the collision happened to return first, and a task dropped on a
     project drew the reorder bar and went nowhere. */
  const taskDragging = useStore((s) => s.draggingTaskId !== null);
  const { setNodeRef: setDropRef, isOver } = useDroppable({
    id, disabled: !sortable || taskDragging,
  });
  const { setNodeRef: setBeforeRef, isOver: beforeOver } = useDroppable({
    id: projectSlotId(projectId, 'before'), disabled: !sortable || taskDragging,
  });
  const { setNodeRef: setAfterRef, isOver: afterOver } = useDroppable({
    id: projectSlotId(projectId, 'after'), disabled: !sortable || taskDragging,
  });
  const nesting = useStore((s) => s.nesting);
  const { active, over } = useDndContext();

  if (!sortable) return <div className={`navrow${className}`} onContextMenu={onContextMenu}>{children}</div>;

  const landing = (isOver || beforeOver || afterOver) && !isDragging && !taskDragging;
  const translated = active?.rect.current.translated;
  const overMiddle = over ? over.rect.top + over.rect.height / 2 : null;
  const activeMiddle = translated ? translated.top + translated.height / 2 : null;
  const position = landing && !nesting
    ? (beforeOver ? 'before' : afterOver ? 'after'
      : activeMiddle !== null && overMiddle !== null && activeMiddle > overMiddle ? 'after' : 'before')
    : null;

  return (
    <div
      ref={(node) => { setNodeRef(node); setDropRef(node); rowRef.current = node; }}
      {...{ [projectRowAttr]: projectId }}
      className={`navrow sortable${isDragging ? ' lifting' : ''}${landing ? (nesting ? ' nesting' : ` drop-${position}`) : ''}${className}`}
      {...attributes}
      {...listeners}
      onContextMenu={onContextMenu}
    >
      <span ref={setBeforeRef} className="project-drop-slot before" aria-hidden="true" />
      {children}
      <span ref={setAfterRef} className="project-drop-slot after" aria-hidden="true" />
    </div>
  );
}

/**
 * A row that can be dropped onto but never picked up.
 *
 * A folder is a place, not a thing you reorder: it holds projects, and the
 * only useful answer to a project landing on one is to put it inside. It
 * registers under the same id a project row does, so the drop is read by the
 * same code that reads every other sidebar drop.
 */
export function ProjectDropRow({
  projectId, className = '', children,
}: {
  projectId: string;
  className?: string;
  children: ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: projectRowId(projectId) });
  const dragging = useStore((s) => s.draggingProjectId);

  return (
    <div
      ref={setNodeRef}
      className={`navrow${isOver && dragging ? ' nesting folderopen' : ''}${className}`}
    >
      {children}
    </div>
  );
}
