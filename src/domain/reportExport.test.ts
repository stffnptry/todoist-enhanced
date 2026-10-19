import { describe, expect, it } from 'vitest';
import { buildReport } from './report';
import { reportDoc, reportFileName, reportHtml, reportMarkdown } from './reportExport';
import { translate, type TranslationKey, type TranslateValues } from '@/i18n';
import { item, due } from '@/test/items';

const t = (key: TranslationKey, values?: TranslateValues) => translate('de', key, values);
const now = new Date('2026-10-18T20:00:00');
const range = { since: new Date('2026-10-12T00:00:00'), until: new Date('2026-10-18T23:59:59.999') };
const report = buildReport({
  range,
  completed: [{ id: '1', user_id: 'me', project_id: 'p', section_id: null, content: 'Rechnung <bezahlen>', completed_at: '2026-10-13T09:00:00' }],
  previous: [],
  log: [{ taskId: 'a', at: '2026-10-14T09:00:00', from: '2026-10-14', to: '2026-10-15', title: 'Steuer', projectId: 'p', labels: [], recurring: false, reason: 'Keine Zeit' }],
  items: { a: item({ id: 'a', content: 'Steuer', due: due('2026-10-15') }) },
  projects: {},
  notes: {},
  now,
});
const doc = reportDoc(report, t, 'de', 'de-DE', now);

describe('report export', () => {
  it('writes German sentences with weekdays and day times filled in', () => {
    expect(doc.analysis[0]).toContain('1 Aufgaben erledigt');
    expect(doc.analysis.join(' ')).not.toMatch(/\{\w+\}/);
    expect(doc.learnings.every((l) => !/\{\w+\}|report\./.test(l.title + l.text))).toBe(true);
  });

  it('builds Markdown with the moved task and its reason', () => {
    const md = reportMarkdown(doc, t);
    expect(md).toContain('# Report:');
    expect(md).toContain('| Steuer | 1× | +1 | offen | Keine Zeit |');
    expect(md).toContain('- [x] Rechnung <bezahlen>');
  });

  it('adds plan against completion to Markdown and HTML', () => {
    const planned = buildReport({
      range,
      completed: [{ id: '2', task_id: '2', user_id: 'me', project_id: 'p', section_id: null, content: 'Bericht', completed_at: '2026-10-16T11:00:00', due: due('2026-10-14') }],
      previous: [], log: [], items: {}, projects: {}, notes: {}, now,
    });
    const d = reportDoc(planned, t, 'de', 'de-DE', now);
    const md = reportMarkdown(d, t);
    expect(md).toContain('## Geplant und abgehakt');
    expect(md).toContain('| Später | 1 |');
    expect(md).toMatch(/\| Bericht \| Mi\., 14\. Okt\. \| Fr\., 16\. Okt\., 11:00 \| \+2 Tg\. \|/);
    expect(reportHtml(d, t, 'de')).toContain('Größte Abweichungen');
  });

  it('escapes task titles in the HTML for the PDF', () => {
    const html = reportHtml(doc, t, 'de');
    expect(html).toContain('Rechnung &lt;bezahlen&gt;');
    expect(html).not.toContain('<script');
  });

  it('gives a file name without slashes or colons', () => {
    expect(reportFileName(doc)).not.toMatch(/[/:]/);
  });
});
