/**
 * Der Report in Worten: einmal übersetzt, dann als Ansicht, als Markdown und
 * als HTML (für das PDF) ausgegeben. So steht in allen drei dasselbe.
 */
import type { TranslationKey, TranslateValues } from '@/i18n';
import { formatDuration } from './estimates';
import type { Locale } from '@/i18n';
import { formatRange } from './periods';
import type { AnalysisLine, DaySlot, Learning, Report } from './report';
import { plainTitle } from './markdown';

type T = (key: TranslationKey, values?: TranslateValues) => string;

export interface ReportDoc {
  title: string;
  rangeLabel: string;
  generated: string;
  kpis: Array<{ label: string; value: string; hint: string }>;
  analysis: string[];
  learnings: Array<{ tone: Learning['tone']; title: string; text: string }>;
  byWeekday: Array<{ label: string; value: number }>;
  bySlot: Array<{ label: string; value: number }>;
  byArea: Array<{ label: string; value: number }>;
  moved: Array<{ title: string; count: number; pushed: number; state: string; reasons: string[] }>;
  reasons: Array<{ text: string; count: number }>;
  overdue: Array<{ title: string; days: number }>;
  done: Array<{ day: string; title: string }>;
  note: string;
}

/** Montag zuerst, wie im Kalender. */
const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];
const SLOTS: DaySlot[] = ['morning', 'midday', 'afternoon', 'evening', 'night'];

export function weekdayName(index: number, intl: string, style: 'long' | 'short' = 'long'): string {
  // 2026-10-18 war ein Sonntag (getDay 0).
  const at = new Date(2026, 9, 18 + index);
  return new Intl.DateTimeFormat(intl, { weekday: style }).format(at);
}

const signed = (n: number) => (n > 0 ? `+${n}` : n < 0 ? `−${Math.abs(n)}` : '0');

/** Kommazahlen in der Schreibweise der Sprache (3,9 statt 3.9). */
const decimal = (n: number, intl: string) => new Intl.NumberFormat(intl, { maximumFractionDigits: 1 }).format(n);

/** Die Werte eines Textes, so aufbereitet, dass sie im Satz stehen können. */
function readable(params: Record<string, string | number>, t: T, intl: string): TranslateValues {
  const out: TranslateValues = { ...params };
  for (const [key, value] of Object.entries(params)) {
    if (typeof value === 'number' && !Number.isInteger(value)) out[key] = decimal(value, intl);
  }
  if (typeof params.weekday === 'number') out.weekday = weekdayName(params.weekday, intl);
  if (typeof params.slot === 'string') out.slot = t(`report.slot.${params.slot}` as TranslationKey);
  return out;
}

export function analysisText(line: AnalysisLine, t: T, intl: string): string {
  const values = readable(line.params, t, intl);
  if (line.id === 'volumeTrend' && typeof line.params.change === 'number') values.change = signed(line.params.change);
  return t(`report.analysis.${line.id}` as TranslationKey, values);
}

export function learningText(l: Learning, t: T, intl: string): { title: string; text: string } {
  const values = readable(l.params, t, intl);
  return {
    title: t(`report.learn.${l.id}.title` as TranslationKey, values),
    text: t(`report.learn.${l.id}.text` as TranslationKey, values),
  };
}

export function reportDoc(r: Report, t: T, locale: Locale, intl: string, now = new Date()): ReportDoc {
  const c = r.completed;
  const dated = c.onTime + c.late;
  const day = new Intl.DateTimeFormat(intl, { weekday: 'short', day: 'numeric', month: 'short' });
  return {
    title: t('report.title'),
    rangeLabel: formatRange(r.range, intl, now),
    generated: t('report.generated', {
      date: new Intl.DateTimeFormat(intl, { dateStyle: 'long', timeStyle: 'short' }).format(now),
    }),
    kpis: [
      {
        label: t('report.kpi.done'),
        value: String(c.count),
        hint: c.change === null
          ? t('report.kpi.doneHint', { perDay: decimal(c.perDay, intl) })
          : `${t('report.kpi.doneHint', { perDay: decimal(c.perDay, intl) })} · ${t('report.vsPrevious', { change: signed(c.change) })}`,
      },
      { label: t('report.kpi.moved'), value: String(r.moves.count), hint: t('report.kpi.movedHint', { tasks: r.moves.tasks }) },
      {
        label: t('report.kpi.onTime'),
        value: dated > 0 ? `${Math.round((c.onTime / dated) * 100)} %` : '–',
        hint: dated > 0 ? t('report.kpi.onTimeHint', { late: c.late }) : t('report.kpi.onTimeNone'),
      },
      { label: t('report.kpi.focus'), value: c.count > 0 ? String(c.focusScore) : '–', hint: t('report.kpi.focusHint', { p1: c.byPriority.p1 }) },
      {
        label: t('report.kpi.time'),
        value: c.minutes > 0 ? formatDuration(c.minutes, locale) : '–',
        hint: t('report.kpi.timeHint', { with: c.withEstimate }),
      },
      { label: t('report.kpi.overdue'), value: String(r.open.overdue), hint: t('report.kpi.overdueHint') },
    ],
    analysis: r.analysis.map((line) => analysisText(line, t, intl)),
    learnings: r.learnings.map((l) => ({ tone: l.tone, ...learningText(l, t, intl) })),
    byWeekday: WEEK_ORDER.map((d) => ({ label: weekdayName(d, intl, 'short'), value: c.byWeekday[d] })),
    bySlot: SLOTS.map((s) => ({ label: t(`report.slot.${s}` as TranslationKey), value: c.bySlot[s] })),
    byArea: c.byArea.map((a) => ({ label: a.name, value: a.count })),
    moved: r.moves.top.slice(0, 10).map((m) => ({
      title: plainTitle(m.title) || '–',
      count: m.count,
      pushed: m.daysPushed,
      state: t(`report.state.${m.state}` as TranslationKey),
      reasons: [...new Set(m.reasons)],
    })),
    reasons: r.moves.reasons.slice(0, 8),
    overdue: r.open.oldest.map((o) => ({ title: plainTitle(o.title), days: o.days })),
    done: c.tasks.map((task) => ({ day: day.format(new Date(task.completed_at)), title: plainTitle(task.content) })),
    note: t('report.logNote'),
  };
}

const TONE_MARK: Record<Learning['tone'], string> = { warn: '⚠️', tip: '💡', good: '✅' };

const mdCell = (text: string) => text.replace(/\|/g, '\\|').replace(/\n/g, ' ');

/** Der Report als Markdown-Datei. */
export function reportMarkdown(doc: ReportDoc, t: T): string {
  const lines: string[] = [];
  lines.push(`# ${doc.title}: ${doc.rangeLabel}`, '', `_${doc.generated}_`, '');
  lines.push(`| ${doc.kpis.map((k) => mdCell(k.label)).join(' | ')} |`);
  lines.push(`|${doc.kpis.map(() => ' --- ').join('|')}|`);
  lines.push(`| ${doc.kpis.map((k) => `**${mdCell(k.value)}**`).join(' | ')} |`);
  lines.push(`| ${doc.kpis.map((k) => mdCell(k.hint)).join(' | ')} |`, '');

  lines.push(`## ${t('report.section.analysis')}`, '', doc.analysis.join(' '), '');
  lines.push(`## ${t('report.section.learnings')}`, '');
  for (const l of doc.learnings) lines.push(`- ${TONE_MARK[l.tone]} **${l.title}** – ${l.text}`);
  lines.push('');

  const table = (head: string, rows: Array<{ label: string; value: number }>) => {
    if (rows.length === 0) return;
    lines.push(`## ${head}`, '', `| ${t('report.col.what')} | ${t('report.col.count')} |`, '| --- | ---: |');
    for (const row of rows) lines.push(`| ${mdCell(row.label)} | ${row.value} |`);
    lines.push('');
  };
  table(t('report.section.weekday'), doc.byWeekday);
  table(t('report.section.slot'), doc.bySlot);
  table(t('report.section.areas'), doc.byArea);

  lines.push(`## ${t('report.section.moved')}`, '');
  if (doc.moved.length === 0) lines.push(t('report.empty.moved'), '');
  else {
    lines.push(`| ${t('report.col.task')} | ${t('report.col.moved')} | ${t('report.col.pushed')} | ${t('report.col.state')} | ${t('report.col.reasons')} |`);
    lines.push('| --- | ---: | ---: | --- | --- |');
    for (const m of doc.moved) {
      lines.push(`| ${mdCell(m.title)} | ${m.count}× | ${m.pushed > 0 ? `+${m.pushed}` : '–'} | ${m.state} | ${mdCell(m.reasons.join('; ')) || '–'} |`);
    }
    lines.push('');
  }
  if (doc.reasons.length > 0) {
    lines.push(`## ${t('report.section.reasons')}`, '');
    for (const r of doc.reasons) lines.push(`- ${r.text} (${r.count}×)`);
    lines.push('');
  }
  if (doc.overdue.length > 0) {
    lines.push(`## ${t('report.section.overdue')}`, '');
    for (const o of doc.overdue) lines.push(`- ${o.title} – ${t('report.overdueDays', { days: o.days, count: o.days })}`);
    lines.push('');
  }
  lines.push(`## ${t('report.section.doneList')}`, '');
  if (doc.done.length === 0) lines.push(t('report.empty.done'));
  for (const d of doc.done) lines.push(`- [x] ${d.title} _(${d.day})_`);
  lines.push('', '---', '', `_${doc.note}_`, '');
  return lines.join('\n');
}

const esc = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Der Report als eigenständige HTML-Seite (ohne Skripte, alles inline), für das PDF. */
export function reportHtml(doc: ReportDoc, t: T, lang: string): string {
  const bars = (rows: Array<{ label: string; value: number }>) => {
    const max = Math.max(1, ...rows.map((r) => r.value));
    return `<table class="bars">${rows.map((r) => `<tr><th>${esc(r.label)}</th><td><span class="bar" style="width:${Math.round((r.value / max) * 100)}%"></span></td><td class="n">${r.value}</td></tr>`).join('')}</table>`;
  };
  const section = (title: string, body: string) => `<section><h2>${esc(title)}</h2>${body}</section>`;
  const moved = doc.moved.length === 0
    ? `<p class="muted">${esc(t('report.empty.moved'))}</p>`
    : `<table class="list"><thead><tr><th>${esc(t('report.col.task'))}</th><th class="n">${esc(t('report.col.moved'))}</th><th class="n">${esc(t('report.col.pushed'))}</th><th>${esc(t('report.col.state'))}</th><th>${esc(t('report.col.reasons'))}</th></tr></thead><tbody>${doc.moved.map((m) => `<tr><td>${esc(m.title)}</td><td class="n">${m.count}×</td><td class="n">${m.pushed > 0 ? `+${m.pushed}` : '–'}</td><td>${esc(m.state)}</td><td>${esc(m.reasons.join('; ')) || '–'}</td></tr>`).join('')}</tbody></table>`;

  return `<!doctype html>
<html lang="${esc(lang)}"><head><meta charset="utf-8"><title>${esc(`${doc.title} ${doc.rangeLabel}`)}</title>
<style>
  *{box-sizing:border-box}
  body{font:10.5pt/1.45 -apple-system,BlinkMacSystemFont,"Helvetica Neue",Helvetica,Arial,sans-serif;color:#1f2328;margin:0;padding:0}
  h1{font-size:20pt;margin:0 0 2pt;letter-spacing:-.01em}
  .range{font-size:12pt;color:#c0392b;font-weight:600;margin:0}
  .gen{color:#6a737d;font-size:9pt;margin:2pt 0 14pt}
  h2{font-size:12.5pt;margin:16pt 0 6pt;padding-bottom:3pt;border-bottom:1px solid #e1e4e8}
  section{break-inside:avoid-page}
  .kpis{display:grid;grid-template-columns:repeat(3,1fr);gap:6pt}
  .kpi{border:1px solid #e1e4e8;border-radius:6pt;padding:7pt 9pt}
  .kpi b{display:block;font-size:17pt;line-height:1.1}
  .kpi span{display:block;color:#6a737d;font-size:8.5pt}
  .kpi i{font-style:normal;font-weight:600;font-size:9pt}
  .learn{border-left:3pt solid #999;padding:4pt 9pt;margin:0 0 6pt;background:#f6f8fa;border-radius:0 5pt 5pt 0;break-inside:avoid}
  .learn.warn{border-color:#d9822b;background:#fff6ec}
  .learn.good{border-color:#2e9e5b;background:#eefaf2}
  .learn.tip{border-color:#3b73c4;background:#eef4fc}
  .learn b{display:block}
  .cols{display:grid;grid-template-columns:1fr 1fr;gap:14pt}
  table{border-collapse:collapse;width:100%}
  .bars th{font-weight:400;text-align:left;width:40%;padding:2pt 6pt 2pt 0;white-space:nowrap}
  .bars td{padding:2pt 0}
  .bar{display:inline-block;height:8pt;background:#c0392b;border-radius:2pt;min-width:1pt;vertical-align:middle}
  .n{text-align:right;width:1%;white-space:nowrap;padding-left:6pt}
  .list th,.list td{border-bottom:1px solid #eaecef;padding:3pt 4pt;text-align:left;vertical-align:top}
  .list th{font-size:8.5pt;color:#6a737d;font-weight:600}
  .list .n{text-align:right}
  .bars td.n{padding-left:8pt}
  ul{margin:0;padding-left:14pt}
  li{margin:1pt 0}
  .muted{color:#6a737d}
  .done li{list-style:none;margin-left:-14pt}
  .done li::before{content:"✓ ";color:#2e9e5b}
  .done small{color:#6a737d}
  footer{margin-top:16pt;color:#6a737d;font-size:8.5pt;border-top:1px solid #e1e4e8;padding-top:6pt}
</style></head><body>
<h1>${esc(doc.title)}</h1>
<p class="range">${esc(doc.rangeLabel)}</p>
<p class="gen">${esc(doc.generated)}</p>
<div class="kpis">${doc.kpis.map((k) => `<div class="kpi"><span>${esc(k.label)}</span><b>${esc(k.value)}</b><span>${esc(k.hint)}</span></div>`).join('')}</div>
${section(t('report.section.analysis'), `<p>${esc(doc.analysis.join(' '))}</p>`)}
${section(t('report.section.learnings'), doc.learnings.map((l) => `<div class="learn ${l.tone}"><b>${esc(l.title)}</b>${esc(l.text)}</div>`).join(''))}
<div class="cols">
${section(t('report.section.weekday'), bars(doc.byWeekday))}
${section(t('report.section.slot'), bars(doc.bySlot))}
</div>
${doc.byArea.length > 0 ? section(t('report.section.areas'), bars(doc.byArea)) : ''}
${section(t('report.section.moved'), moved)}
${doc.reasons.length > 0 ? section(t('report.section.reasons'), `<ul>${doc.reasons.map((r) => `<li>${esc(r.text)} (${r.count}×)</li>`).join('')}</ul>`) : ''}
${doc.overdue.length > 0 ? section(t('report.section.overdue'), `<ul>${doc.overdue.map((o) => `<li>${esc(o.title)} – <span class="muted">${esc(t('report.overdueDays', { days: o.days, count: o.days }))}</span></li>`).join('')}</ul>`) : ''}
${section(t('report.section.doneList'), doc.done.length === 0 ? `<p class="muted">${esc(t('report.empty.done'))}</p>` : `<ul class="done">${doc.done.map((d) => `<li>${esc(d.title)} <small>${esc(d.day)}</small></li>`).join('')}</ul>`)}
<footer>${esc(doc.note)}</footer>
</body></html>`;
}

/** Ein Dateiname wie „Report 12. – 18. Okt.“, ohne Zeichen, die macOS stören. */
export function reportFileName(doc: ReportDoc): string {
  return `${doc.title} ${doc.rangeLabel}`.replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ').trim();
}
