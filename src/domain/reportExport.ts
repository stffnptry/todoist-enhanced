/**
 * Der Report in Worten: einmal übersetzt, dann als Ansicht, als Markdown und
 * als HTML (für das PDF) ausgegeben. So steht in allen drei dasselbe.
 */
import type { TranslationKey, TranslateValues } from '@/i18n';
import { formatDuration } from './estimates';
import type { Locale } from '@/i18n';
import { formatRange } from './periods';
import type { AnalysisLine, DaySlot, Learning, Report } from './report';
import type { PlanRow } from './planVsActual';
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
  /** Als „nicht erledigt“ abgehakt, mit Grund. */
  notDone: Array<{ day: string; title: string; reason: string }>;
  timing: {
    /** Früher / am Tag / später / ohne Datum. */
    split: Array<{ label: string; value: number }>;
    /** Nur Aufgaben mit Uhrzeit: wie nah am Plan. */
    clock: Array<{ label: string; value: number }>;
    byWeekday: Array<{ label: string; planned: number; kept: number; share: number }>;
    byArea: Array<{ label: string; planned: number; kept: number; share: number }>;
    biggest: Array<{ title: string; planned: string; done: string; diff: string; original: string | null; late: boolean }>;
  };
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
      { label: t('report.kpi.notDone'), value: String(r.notDone.count), hint: t('report.kpi.notDoneHint') },
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
    notDone: r.notDone.tasks.map((task) => ({ day: day.format(task.at), title: plainTitle(task.title) || '–', reason: task.reason })),
    timing: timingDoc(r, t, intl),
    note: t('report.logNote'),
  };
}

const share = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 100) : 0);

/** Abweichung als kurzer Text: Tage, oder am selben Tag die Minuten. */
function diffText(row: PlanRow, t: T): string {
  if (row.dayDiff !== 0) return t('report.timing.days', { n: signed(row.dayDiff) });
  if (row.minuteDiff !== null) return t('report.timing.minutes', { n: signed(row.minuteDiff) });
  return '0';
}

function timingDoc(r: Report, t: T, intl: string): ReportDoc['timing'] {
  const tm = r.timing;
  const day = new Intl.DateTimeFormat(intl, { weekday: 'short', day: 'numeric', month: 'short' });
  const time = new Intl.DateTimeFormat(intl, { hour: '2-digit', minute: '2-digit' });
  const plannedText = (row: PlanRow) => {
    const at = row.hasTime ? new Date(row.planned) : new Date(`${row.planned.slice(0, 10)}T00:00:00`);
    return row.hasTime ? `${day.format(at)}, ${time.format(at)}` : day.format(at);
  };
  const weight = (row: PlanRow) => (row.minuteDiff !== null ? Math.abs(row.minuteDiff) : Math.abs(row.dayDiff) * 1440);
  return {
    split: [
      { label: t('report.timing.early'), value: tm.early },
      { label: t('report.timing.onDay'), value: tm.onDay },
      { label: t('report.timing.late'), value: tm.late },
      { label: t('report.timing.unplanned'), value: tm.unplanned },
    ],
    clock: tm.timed.count === 0 ? [] : [
      { label: t('report.timing.clockEarlier'), value: tm.timed.earlier },
      { label: t('report.timing.close'), value: tm.timed.close },
      { label: t('report.timing.clockLater'), value: tm.timed.later },
    ],
    byWeekday: WEEK_ORDER
      .filter((d) => tm.byPlannedWeekday[d].planned > 0)
      .map((d) => ({ label: weekdayName(d, intl, 'short'), ...tm.byPlannedWeekday[d], share: share(tm.byPlannedWeekday[d].kept, tm.byPlannedWeekday[d].planned) })),
    // Ein einziger Bereich sagt nichts über Unterschiede.
    byArea: tm.byArea.length < 2 ? [] : tm.byArea.map((a) => ({ label: a.name, planned: a.planned, kept: a.kept, share: share(a.kept, a.planned) })),
    biggest: tm.rows
      .filter((row) => row.dayDiff !== 0 || Math.abs(row.minuteDiff ?? 0) > 30)
      .sort((a, b) => weight(b) - weight(a))
      .slice(0, 10)
      .map((row) => ({
        title: plainTitle(row.title) || '–',
        planned: plannedText(row),
        done: `${day.format(row.doneAt)}, ${time.format(row.doneAt)}`,
        diff: diffText(row, t),
        original: row.original && row.original !== row.planned.slice(0, 10)
          ? t('report.timing.original', { date: day.format(new Date(`${row.original}T00:00:00`)) })
          : null,
        late: row.dayDiff > 0 || (row.dayDiff === 0 && (row.minuteDiff ?? 0) > 30),
      })),
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

  const tm = doc.timing;
  lines.push(`## ${t('report.section.timing')}`, '');
  if (tm.split.every((s) => s.value === 0)) lines.push(t('report.empty.timing'), '');
  else {
    lines.push(`| ${t('report.col.what')} | ${t('report.col.count')} |`, '| --- | ---: |');
    for (const row of [...tm.split, ...tm.clock]) lines.push(`| ${mdCell(row.label)} | ${row.value} |`);
    lines.push('');
    const kept = (head: string, rows: Array<{ label: string; planned: number; kept: number; share: number }>) => {
      if (rows.length === 0) return;
      lines.push(`### ${head}`, '', `| ${t('report.col.what')} | ${t('report.col.planned')} | ${t('report.col.kept')} | % |`, '| --- | ---: | ---: | ---: |');
      for (const row of rows) lines.push(`| ${mdCell(row.label)} | ${row.planned} | ${row.kept} | ${row.share} % |`);
      lines.push('');
    };
    kept(t('report.section.timingWeekday'), tm.byWeekday);
    kept(t('report.section.timingAreas'), tm.byArea);
    if (tm.biggest.length > 0) {
      lines.push(`### ${t('report.section.timingBiggest')}`, '');
      lines.push(`| ${t('report.col.task')} | ${t('report.col.planned')} | ${t('report.col.doneAt')} | ${t('report.col.diff')} |`, '| --- | --- | --- | ---: |');
      for (const b of tm.biggest) {
        lines.push(`| ${mdCell(b.title)} | ${mdCell(b.planned)}${b.original ? ` (${mdCell(b.original)})` : ''} | ${mdCell(b.done)} | ${b.diff} |`);
      }
      lines.push('');
    }
  }

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
  lines.push(`## ${t('report.section.notDone')}`, '');
  if (doc.notDone.length === 0) lines.push(t('report.empty.notDone'), '');
  else {
    lines.push(`| ${t('report.col.task')} | ${t('report.col.when')} | ${t('report.col.reason')} |`, '| --- | --- | --- |');
    for (const n of doc.notDone) lines.push(`| ${mdCell(n.title)} | ${mdCell(n.day)} | ${mdCell(n.reason)} |`);
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

  const tm = doc.timing;
  const keptTable = (rows: Array<{ label: string; planned: number; kept: number; share: number }>) =>
    `<table class="list"><thead><tr><th>${esc(t('report.col.what'))}</th><th class="n">${esc(t('report.col.planned'))}</th><th class="n">${esc(t('report.col.kept'))}</th><th class="n">%</th></tr></thead><tbody>${rows.map((r) => `<tr><td>${esc(r.label)}</td><td class="n">${r.planned}</td><td class="n">${r.kept}</td><td class="n">${r.share} %</td></tr>`).join('')}</tbody></table>`;
  const timing = tm.split.every((s) => s.value === 0)
    ? `<p class="muted">${esc(t('report.empty.timing'))}</p>`
    : `<div class="cols"><div>${bars(tm.split)}</div><div>${tm.clock.length > 0 ? `<h3>${esc(t('report.section.timingClock'))}</h3>${bars(tm.clock)}` : ''}</div></div>`
      + `<div class="cols">${tm.byWeekday.length > 0 ? `<div><h3>${esc(t('report.section.timingWeekday'))}</h3>${keptTable(tm.byWeekday)}</div>` : ''}${tm.byArea.length > 0 ? `<div><h3>${esc(t('report.section.timingAreas'))}</h3>${keptTable(tm.byArea)}</div>` : ''}</div>`
      + (tm.biggest.length > 0
        ? `<h3>${esc(t('report.section.timingBiggest'))}</h3><table class="list"><thead><tr><th>${esc(t('report.col.task'))}</th><th>${esc(t('report.col.planned'))}</th><th>${esc(t('report.col.doneAt'))}</th><th class="n">${esc(t('report.col.diff'))}</th></tr></thead><tbody>${tm.biggest.map((b) => `<tr><td>${esc(b.title)}</td><td>${esc(b.planned)}${b.original ? `<br><small class="muted">${esc(b.original)}</small>` : ''}</td><td>${esc(b.done)}</td><td class="n${b.late ? ' late' : ''}">${esc(b.diff)}</td></tr>`).join('')}</tbody></table>`
        : '');

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
  h3{font-size:10pt;margin:10pt 0 4pt;color:#444}
  td.late{color:#c0392b;font-weight:600}
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
${section(t('report.section.timing'), timing)}
${section(t('report.section.moved'), moved)}
${doc.reasons.length > 0 ? section(t('report.section.reasons'), `<ul>${doc.reasons.map((r) => `<li>${esc(r.text)} (${r.count}×)</li>`).join('')}</ul>`) : ''}
${doc.overdue.length > 0 ? section(t('report.section.overdue'), `<ul>${doc.overdue.map((o) => `<li>${esc(o.title)} – <span class="muted">${esc(t('report.overdueDays', { days: o.days, count: o.days }))}</span></li>`).join('')}</ul>`) : ''}
${section(t('report.section.notDone'), doc.notDone.length === 0 ? `<p class="muted">${esc(t('report.empty.notDone'))}</p>` : `<table class="list"><thead><tr><th>${esc(t('report.col.task'))}</th><th>${esc(t('report.col.when'))}</th><th>${esc(t('report.col.reason'))}</th></tr></thead><tbody>${doc.notDone.map((n) => `<tr><td>${esc(n.title)}</td><td>${esc(n.day)}</td><td>${esc(n.reason)}</td></tr>`).join('')}</tbody></table>`)}
${section(t('report.section.doneList'), doc.done.length === 0 ? `<p class="muted">${esc(t('report.empty.done'))}</p>` : `<ul class="done">${doc.done.map((d) => `<li>${esc(d.title)} <small>${esc(d.day)}</small></li>`).join('')}</ul>`)}
<footer>${esc(doc.note)}</footer>
</body></html>`;
}

/** Ein Dateiname wie „Report 12. – 18. Okt.“, ohne Zeichen, die macOS stören. */
export function reportFileName(doc: ReportDoc): string {
  return `${doc.title} ${doc.rangeLabel}`.replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ').trim();
}
