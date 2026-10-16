import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/db/idb', () => ({
  saveSnapshot: vi.fn(async () => {}),
  enqueue: vi.fn(async () => {}),
  dequeue: vi.fn(async () => {}),
  updateQueued: vi.fn(async () => {}),
  readQueue: vi.fn(async () => []),
}));
vi.mock('@/api/commands', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/commands')>()),
  sendCommands: vi.fn(),
}));

import { sendCommands, type Command, type CommandResult } from '@/api/commands';
import { defaultViewPrefs, emptySnapshot } from '@/domain/types';
import { item } from '@/test/items';
import { useStore } from './store';

const sent = vi.mocked(sendCommands);
const ok = (commands: Command[]): CommandResult => ({
  responses: [], failures: [], mapping: {},
  delivered: commands.map((cmd) => cmd.uuid), undelivered: [],
});
const types = () => sent.mock.calls.flatMap(([, commands]) => commands.map((c) => c.type));

beforeEach(() => {
  vi.stubGlobal('navigator', { onLine: true });
  vi.clearAllMocks();
  sent.mockImplementation(async (_token, commands) => ok(commands));
  const snapshot = emptySnapshot();
  snapshot.items.ticket = item({ id: 'ticket', project_id: 'p', labels: ['Arbeit'] });
  snapshot.items.sub = item({ id: 'sub', project_id: 'p', parent_id: 'ticket' });
  useStore.setState({ demo: false, snapshot, toasts: [], undoStack: [], pendingCount: 0, syncState: 'idle' });
  useStore.setState({ prefs: { ...useStore.getState().prefs, views: {} } });
});
afterEach(() => vi.unstubAllGlobals());

describe('Kanban-Status im Store', () => {
  it('„In Arbeit“ setzt das Label und lässt die Tags stehen', async () => {
    await useStore.getState().setTaskStatus(['ticket'], 'doing');
    expect(useStore.getState().snapshot.items.ticket.labels).toEqual(['Arbeit', 'StatusInArbeit']);
    expect(types()).toEqual(['item_update']);
  });

  it('„Abgeschlossen“ hakt ab, „Offen“ macht wieder auf', async () => {
    await useStore.getState().setTaskStatus(['ticket'], 'done');
    expect(useStore.getState().snapshot.items.ticket.checked).toBe(true);
    expect(types()).toEqual(['item_update', 'item_complete']);
    sent.mockClear();
    await useStore.getState().setTaskStatus(['ticket'], 'open');
    expect(useStore.getState().snapshot.items.ticket).toMatchObject({ checked: false, labels: ['Arbeit', 'StatusOffen'] });
    expect(types()).toEqual(['item_uncomplete', 'item_update']);
  });

  it('eine abgehakte Unteraufgabe schiebt die Aufgabe auf „In Arbeit“ – nur im Kanban-Projekt', async () => {
    await useStore.getState().toggleTask('sub');
    expect(useStore.getState().snapshot.items.ticket.labels).toEqual(['Arbeit']);

    await useStore.getState().toggleTask('sub'); // wieder auf
    const prefs = useStore.getState().prefs;
    useStore.setState({ prefs: { ...prefs, views: { 'project:p': { ...defaultViewPrefs('project:p'), group: 'status' } } } });
    await useStore.getState().toggleTask('sub');
    expect(useStore.getState().snapshot.items.ticket.labels).toEqual(['Arbeit', 'StatusInArbeit']);
  });
});
