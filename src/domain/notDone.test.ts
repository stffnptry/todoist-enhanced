import { describe, expect, it } from 'vitest';
import { isNotDoneComment, notDoneCommentText, notDoneReasonOf, notDoneTasks } from './notDone';
import { buildReport } from './report';
import { completionsFrom, mergeCompletions, type CompletionEntry } from '@/lib/completionLog';
import type { CompletedItem, Note } from './types';
import { due, item } from '@/test/items';

const week = { since: new Date('2026-10-12T00:00:00'), until: new Date('2026-10-18T23:59:59.999') };
const now = new Date('2026-10-18T20:00:00');

const note = (id: string, itemId: string, at: string, content: string): Note => ({
  id, item_id: itemId, project_id: null, content, posted_at: at, posted_uid: 'me', is_deleted: false, file_attachment: null,
});
const done = (id: string, at: string): CompletedItem => ({
  id, task_id: id, user_id: 'me', project_id: 'p', section_id: null, content: `Task ${id}`, completed_at: at,
});
const entry = (taskId: string, at: string, extra: Partial<CompletionEntry> = {}): CompletionEntry => ({
  taskId, at, planned: '2026-10-14', title: `Task ${taskId}`, projectId: 'p', labels: [], recurring: false, ...extra,
});

describe('comment text', () => {
  it('needs a reason and starts with the mark', () => {
    expect(notDoneCommentText('Nicht erledigt', '  ')).toBeNull();
    const text = notDoneCommentText('Nicht erledigt', ' Nicht mehr nötig ');
    expect(text).toBe('⊘ Nicht erledigt: Nicht mehr nötig');
    expect(isNotDoneComment(text)).toBe(true);
    expect(isNotDoneComment('↻ Verschoben: x')).toBe(false);
    expect(notDoneReasonOf(text!)).toBe('Nicht mehr nötig');
    expect(notDoneReasonOf('⊘ Not done: Grund: mit Doppelpunkt')).toBe('Grund: mit Doppelpunkt');
  });
});

describe('notDoneTasks', () => {
  it('takes the log and adds comments the log does not know', () => {
    const log = [entry('a', '2026-10-14T09:00:00', { notDone: 'Erledigt sich von selbst' }), entry('b', '2026-10-14T10:00:00')];
    const notes = {
      n1: note('n1', 'a', '2026-10-14T08:59:58', '⊘ Nicht erledigt: Erledigt sich von selbst'),
      n2: note('n2', 'c', '2026-10-15T11:00:00', '⊘ Not done: Zu teuer'),
    };
    const items = { c: item({ id: 'c', content: 'Kaufen', checked: true }) };
    const list = notDoneTasks(log, notes, items);
    expect(list.map((e) => [e.taskId, e.reason])).toEqual([['a', 'Erledigt sich von selbst'], ['c', 'Zu teuer']]);
  });

  it('ignores a comment on a task that is open again (undone)', () => {
    const notes = { n: note('n', 'c', '2026-10-15T11:00:00', '⊘ Nicht erledigt: x') };
    expect(notDoneTasks([], notes, { c: item({ id: 'c' }) })).toEqual([]);
  });

  it('keeps comments on a recurring task, which is open again by design', () => {
    const notes = { n: note('n', 'r', '2026-10-15T11:00:00', '⊘ Nicht erledigt: Krank') };
    const items = { r: item({ id: 'r', content: 'Joggen', due: due('2026-10-16', { is_recurring: true }) }) };
    expect(notDoneTasks([], notes, items)).toMatchObject([{ taskId: 'r', title: 'Joggen', reason: 'Krank', recurring: true }]);
  });
});

describe('completion log', () => {
  it('keeps the reason through merging and drops it when reopened at once', () => {
    const added = [entry('a', '2026-10-14T09:00:00', { notDone: 'x' })];
    expect(mergeCompletions([], added, [], new Date('2026-10-14T09:01:00'))[0].notDone).toBe('x');
    expect(mergeCompletions(added, [], ['a'], new Date('2026-10-14T09:01:00'))).toEqual([]);
  });

  it('records a close without a reason as a plain completion', () => {
    const before = { items: { a: item({ id: 'a' }) } } as never;
    const [e] = completionsFrom(before, [{ type: 'item_close', uuid: 'u', args: { id: 'a' } }]);
    expect(e.notDone).toBeUndefined();
  });
});

describe('report', () => {
  it('lists not-done tasks apart and does not count them as done', () => {
    const completed = [done('a', '2026-10-14T09:00:05'), done('b', '2026-10-15T09:00:00')];
    const completions = [entry('a', '2026-10-14T09:00:00', { notDone: 'Nicht mehr nötig' })];
    const r = buildReport({
      range: week, completed, previous: [], log: [], completions,
      items: {}, projects: {}, notes: {}, now,
    });
    expect(r.completed.count).toBe(1);
    expect(r.completed.tasks.map((c) => c.task_id)).toEqual(['b']);
    expect(r.notDone.count).toBe(1);
    expect(r.notDone.tasks[0]).toMatchObject({ taskId: 'a', reason: 'Nicht mehr nötig' });
    expect(r.notDone.reasons).toEqual([{ text: 'Nicht mehr nötig', count: 1 }]);
    expect(r.analysis.some((line) => line.id === 'notDone')).toBe(true);
  });

  it('leaves out not-done tasks outside the range', () => {
    const completions = [entry('a', '2026-10-01T09:00:00', { notDone: 'x' })];
    const r = buildReport({ range: week, completed: [], previous: [], log: [], completions, items: {}, projects: {}, notes: {}, now });
    expect(r.notDone.count).toBe(0);
  });
});
