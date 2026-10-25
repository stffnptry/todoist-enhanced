import { describe, expect, it } from 'vitest';
import type { Command } from '@/api/commands';
import { emptySnapshot, type Item, type Snapshot } from './types';
import { canStoreDeadlines, deadlinesToNotes, noteDeadlineMigration, parseDeadlineNote, readDeadlineNote, withDeadlineNote } from './deadlineNote';

const item = (patch: Partial<Item> = {}): Item => ({
  id: 't1', user_id: 'u', project_id: 'p', section_id: null, parent_id: null, content: 'Rechnung',
  description: '', priority: 1, due: null, deadline: null, duration: null, labels: [], child_order: 0,
  day_order: -1, collapsed: false, checked: false, is_deleted: false, added_at: null, completed_at: null,
  updated_at: null, responsible_uid: null, ...patch,
} as Item);

const snap = (items: Item[]): Snapshot => ({ ...emptySnapshot(), items: Object.fromEntries(items.map((i) => [i.id, i])) });
const cmd = (type: string, args: Record<string, unknown>): Command => ({ type, uuid: 'x', args });

describe('deadline note', () => {
  it('reads the last valid line, German or ISO, and strips it', () => {
    expect(parseDeadlineNote('Notiz\n\nDeadline: 26.10.2026')).toEqual({ date: '2026-10-26', rest: 'Notiz' });
    expect(parseDeadlineNote('deadline: 2026-11-03')).toEqual({ date: '2026-11-03', rest: '' });
    expect(parseDeadlineNote('Deadline: 31.02.2026')).toEqual({ date: null, rest: 'Deadline: 31.02.2026' });
    expect(parseDeadlineNote('Die Deadline: bald').date).toBeNull();
  });

  it('writes one line at the end, replacing an old one', () => {
    expect(withDeadlineNote('Notiz\n\nDeadline: 01.01.2026', { date: '2026-10-26', lang: 'de' })).toBe('Notiz\n\nDeadline: 26.10.2026');
    expect(withDeadlineNote('', { date: '2026-10-26', lang: 'de' })).toBe('Deadline: 26.10.2026');
    expect(withDeadlineNote('Notiz\n\nDeadline: 26.10.2026', null)).toBe('Notiz');
  });

  it('turns the line into a deadline when reading a task', () => {
    const read = readDeadlineNote(item({ description: 'IBAN siehe Mail\n\nDeadline: 26.10.2026' }));
    expect(read.deadline).toEqual({ date: '2026-10-26', lang: 'de' });
    expect(read.description).toBe('IBAN siehe Mail');
    const plain = item({ description: 'nichts' });
    expect(readDeadlineNote(plain)).toBe(plain);
  });

  it('knows the free plan', () => {
    expect(canStoreDeadlines({ is_premium: false, premium_status: 'not_premium' })).toBe(false);
    expect(canStoreDeadlines({ is_premium: true })).toBe(true);
  });

  it('free: an added task carries its deadline in the description', () => {
    const [out] = deadlinesToNotes([cmd('item_add', { content: 'A', description: 'Notiz', deadline: { date: '2026-10-26', lang: 'en' } })], snap([]), false);
    expect(out.args).toEqual({ content: 'A', description: 'Notiz\n\nDeadline: 26.10.2026' });
    const [none] = deadlinesToNotes([cmd('item_add', { content: 'A', deadline: undefined })], snap([]), false);
    expect(none.args).toEqual({ content: 'A' });
  });

  it('free: an update rewrites the description from the state after the change', () => {
    const after = snap([item({ description: 'Notiz', deadline: { date: '2026-10-26', lang: 'de' } })]);
    const [setDeadline] = deadlinesToNotes([cmd('item_update', { id: 't1', deadline: { date: '2026-10-26', lang: 'de' } })], after, false);
    expect(setDeadline.args).toEqual({ id: 't1', description: 'Notiz\n\nDeadline: 26.10.2026' });
    const [editText] = deadlinesToNotes([cmd('item_update', { id: 't1', description: 'Neu' })], after, false);
    expect(editText.args).toEqual({ id: 't1', description: 'Neu\n\nDeadline: 26.10.2026' });
    const [clear] = deadlinesToNotes([cmd('item_update', { id: 't1', deadline: null })], snap([item({ description: 'Notiz' })]), false);
    expect(clear.args).toEqual({ id: 't1', description: 'Notiz' });
    const [other] = deadlinesToNotes([cmd('item_update', { id: 't1', priority: 4 })], after, false);
    expect(other.args).toEqual({ id: 't1', priority: 4 });
  });

  it('pro: the field stays, and goes along with a description so a line deadline is kept', () => {
    const after = snap([item({ deadline: { date: '2026-10-26', lang: 'de' } })]);
    const add = cmd('item_add', { content: 'A', deadline: { date: '2026-10-26', lang: 'en' } });
    expect(deadlinesToNotes([add], after, true)[0]).toBe(add);
    expect(deadlinesToNotes([cmd('item_update', { id: 't1', description: 'X' })], after, true)[0].args)
      .toEqual({ id: 't1', description: 'X', deadline: { date: '2026-10-26', lang: 'de' } });
  });
});

describe('Umstellung auf Pro', () => {
  it('schreibt Deadlines aus der Beschreibung einmal ins echte Feld, nur bei offenen Aufgaben', () => {
    const fromNote = readDeadlineNote(item({ id: 'a', description: 'IBAN siehe Mail\n\nDeadline: 26.10.2026' }));
    const done = readDeadlineNote(item({ id: 'b', checked: true, description: 'Deadline: 01.11.2026' }));
    const native = item({ id: 'c', deadline: { date: '2026-11-02', lang: 'de' } });
    const commands = noteDeadlineMigration({ a: fromNote, b: done, c: native });
    expect(commands.map((c) => c.args)).toEqual([
      { id: 'a', description: 'IBAN siehe Mail', deadline: { date: '2026-10-26', lang: 'de' } },
    ]);
    expect(noteDeadlineMigration({ a: fromNote }, new Set(['a']))).toEqual([]);
  });
});
