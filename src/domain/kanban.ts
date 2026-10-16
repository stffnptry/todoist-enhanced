import type { Item } from './types';

/**
 * Kanban-Status einer Aufgabe: Offen, In Arbeit, Abgeschlossen.
 *
 * Todoist kennt keinen Status, also steht er als Label an der Aufgabe
 * („StatusOffen“, „StatusInArbeit“, „StatusAbgeschlossen“), damit er auch in
 * Todoist selbst sichtbar und filterbar ist. In dieser App ist er kein Label,
 * sondern ein eigenes Feld: die Labels werden überall ausgeblendet, wo Tags
 * gezeigt oder gewählt werden.
 *
 * Abgehakt ist immer „Abgeschlossen“, egal welches Label noch dran ist; ohne
 * Status-Label ist eine Aufgabe „Offen“.
 */
export type TaskStatus = 'open' | 'doing' | 'done';

export const TASK_STATUSES: TaskStatus[] = ['open', 'doing', 'done'];

export const STATUS_LABELS: Record<TaskStatus, string> = {
  open: 'StatusOffen',
  doing: 'StatusInArbeit',
  done: 'StatusAbgeschlossen',
};

const statusNames = new Set(Object.values(STATUS_LABELS).map((name) => name.toLowerCase()));

export const isStatusLabel = (name: string): boolean => statusNames.has(name.toLowerCase());

/** Labels, die nie als Tag erscheinen: Schätzungen (`est-…`) und der Kanban-Status. */
export const isHiddenLabel = (name: string): boolean =>
  name.toLowerCase().startsWith('est-') || isStatusLabel(name);

export function statusOf(item: Pick<Item, 'checked' | 'labels'>): TaskStatus {
  if (item.checked) return 'done';
  const doing = STATUS_LABELS.doing.toLowerCase();
  return item.labels.some((label) => label.toLowerCase() === doing) ? 'doing' : 'open';
}

/** Die Labels einer Aufgabe mit genau einem Status-Label, dem neuen. */
export function labelsWithStatus(labels: string[], status: TaskStatus): string[] {
  return [...labels.filter((label) => !isStatusLabel(label)), STATUS_LABELS[status]];
}

/** Ein Projekt arbeitet als Kanban, wenn seine Ansicht nach Status gruppiert ist. */
export const isKanbanView = (group: string | undefined): boolean => group === 'status';
