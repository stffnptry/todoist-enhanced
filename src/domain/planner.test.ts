import { describe, expect, it } from 'vitest';
import { decisionLogLines, localDateTime, parsePlanAnswer, plannerSystemPrompt } from './planner';
import { item } from '@/test/items';
import type { Snapshot } from './types';

const open = (id: string) => id === 'a' || id === 'b';

describe('planning with Claude', () => {
  it('reads the proposals and keeps the text apart', () => {
    const answer = [
      'Mein Vorschlag:',
      '- Briefing um 9:00',
      '```actions',
      '[{"type":"schedule","taskId":"a","start":"2026-10-14T09:00","minutes":45},',
      ' {"type":"date","taskId":"b","date":"2026-10-15"}]',
      '```',
    ].join('\n');
    const { text, actions } = parsePlanAnswer(answer, open);
    expect(text).toBe('Mein Vorschlag:\n- Briefing um 9:00');
    expect(actions).toEqual([
      { type: 'schedule', taskId: 'a', start: '2026-10-14T09:00', minutes: 45 },
      { type: 'date', taskId: 'b', date: '2026-10-15' },
    ]);
  });

  it('drops unknown tasks and malformed entries instead of guessing', () => {
    const answer = '```actions\n[{"type":"schedule","taskId":"zz","start":"2026-10-14T09:00","minutes":30},'
      + '{"type":"schedule","taskId":"a","start":"morgen","minutes":30},'
      + '{"type":"schedule","taskId":"a","start":"2026-10-14T09:00","minutes":0},'
      + '{"type":"delete","taskId":"a"}]\n```';
    expect(parsePlanAnswer(answer, open).actions).toEqual([]);
    expect(parsePlanAnswer('```actions\nkein json\n```', open).actions).toEqual([]);
    expect(parsePlanAnswer('Nur Text.', open)).toEqual({ text: 'Nur Text.', actions: [], memory: [] });
  });

  it('reads a local time as local time', () => {
    const d = localDateTime('2026-10-14T09:30');
    expect([d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes()]).toEqual([2026, 9, 14, 9, 30]);
  });

  it('tells Claude about tasks, capacity and events, with ids', () => {
    const now = new Date(2026, 9, 14, 8, 0);
    const task = item({ id: 't1', content: '**Briefing** lesen', priority: 4, due: { date: '2026-10-14', string: 'today', lang: 'en', timezone: null, is_recurring: false } });
    const prompt = plannerSystemPrompt({
      snapshot: { items: { t1: task }, projects: {}, user: { inbox_project_id: 'inbox', start_day: 1 } as Snapshot['user'] },
      roots: [task],
      minutesOf: () => 45,
      events: [{ id: 'e', calendarId: 'c', title: 'Daily', start: new Date(2026, 9, 14, 9).toISOString(), end: new Date(2026, 9, 14, 9, 15).toISOString(), allDay: false, location: '', notes: '', url: '' }],
      calendars: [{ id: 'c', title: 'Arbeit', color: '#000', source: 'Exchange', writable: false, subscribed: true }],
      capacity: [0, 480, 480, 480, 480, 480, 0],
      now,
      language: 'German',
      calendarTarget: null,
    });
    expect(prompt).toContain('Answer in German');
    expect(prompt).toContain('[t1] Briefing lesen | P1 | due 2026-10-14 | estimate 45 min');
    expect(prompt).toContain('Wed 2026-10-14 09:00–09:15 Daily (Arbeit)');
    expect(prompt).toContain('Wed 2026-10-14: 8h00');
  });

  it('keeps proposed memory apart from the text and the proposals', () => {
    const answer = [
      'Plan steht.',
      '```actions',
      '[{"type":"date","taskId":"a","date":"2026-10-15"}]',
      '```',
      '```memory',
      '- Du machst Sport lieber abends.',
      '* Freitags nur Kleinkram.',
      '',
      '```',
    ].join('\n');
    const { text, actions, memory } = parsePlanAnswer(answer, open);
    expect(text).toBe('Plan steht.');
    expect(actions).toEqual([{ type: 'date', taskId: 'a', date: '2026-10-15' }]);
    expect(memory).toEqual(['Du machst Sport lieber abends.', 'Freitags nur Kleinkram.']);
  });

  it('reads memory without proposals, and nothing when there is none', () => {
    expect(parsePlanAnswer('Ok.\n```memory\n- Mag frühe Termine.\n```', open)).toEqual({ text: 'Ok.', actions: [], memory: ['Mag frühe Termine.'] });
    expect(parsePlanAnswer('Nur Text.', open).memory).toEqual([]);
  });

  it('writes accepted and declined proposals as log lines', () => {
    const lines = decisionLogLines(new Date(2026, 9, 15, 9, 30), [
      { name: 'Sport', when: 'Do., 15. Okt. 18:00–19:00', accepted: true },
      { name: 'Steuer', when: 'Fr., 16. Okt.', accepted: false },
    ]);
    expect(lines).toEqual([
      '- 2026-10-15 09:30 ✓ Sport → Do., 15. Okt. 18:00–19:00',
      '- 2026-10-15 09:30 ✗ Steuer → Fr., 16. Okt.',
    ]);
  });
});
