import { describe, expect, it } from 'vitest';
import { pruneOccurrences } from './doneOccurrences';

describe('done occurrences of recurring tasks', () => {
  it('keeps the last weeks, each occurrence once', () => {
    const now = new Date(2026, 9, 15).getTime();
    expect(pruneOccurrences([
      { taskId: 'a', start: new Date(2026, 9, 14, 9).toISOString() },
      { taskId: 'a', start: new Date(2026, 9, 14, 9).toISOString() },
      { taskId: 'a', start: new Date(2026, 9, 13, 9).toISOString() },
      { taskId: 'b', start: new Date(2026, 5, 1, 9).toISOString() },
      { taskId: 'c', start: 'kaputt' },
    ], now).map((o) => `${o.taskId}:${new Date(o.start).getDate()}`)).toEqual(['a:14', 'a:13']);
  });
});
