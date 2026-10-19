import { useEffect, useMemo, useState } from 'react';
import { Icon } from '@/components/Icon';
import { DateField } from '@/components/DateField';
import { Bars, ChartCard, RankedBars, StatTile, type BarDatum } from '@/components/charts';
import { useT } from '@/hooks/useT';
import { useStore } from '@/store/store';
import { useCompleted } from '@/hooks/useCompleted';
import { loadReschedules, type RescheduleEntry } from '@/lib/rescheduleLog';
import { loadCompletions, type CompletionEntry } from '@/lib/completionLog';
import { buildReport, demoCompletions, demoReschedules, QUICK_RANGES, quickRange, type QuickRange } from '@/domain/report';
import { reportDoc, reportFileName, reportHtml, reportMarkdown } from '@/domain/reportExport';
import type { Range } from '@/domain/periods';
import { toApiDate } from '@/domain/dates';
import { intlLocale, type TranslationKey } from '@/i18n';

/**
 * Report: ein Rückblick auf einen Zeitraum – was erledigt wurde, was oft
 * umgeplant wurde, eine Verhaltensanalyse mit Learnings, und das Ganze als
 * Markdown- oder PDF-Datei. Die Rechnung steht in domain/report.ts, die Texte
 * für Ansicht und Export in domain/reportExport.ts.
 */
export function ReportView({ onOpen }: { onOpen?: (id: string) => void }) {
  const { t, locale } = useT();
  const intl = intlLocale(locale);
  const snapshot = useStore((s) => s.snapshot);
  const demo = useStore((s) => s.demo);
  const toast = useStore((s) => s.toast);
  const startDay = snapshot.user?.start_day ?? 1;

  const [quick, setQuick] = useState<QuickRange>('thisWeek');
  const [custom, setCustom] = useState<Range | null>(null);
  const range = useMemo(() => quickRange(quick, custom, startDay), [quick, custom, startDay]);
  const { data: completed, previous, loading, error, retry } = useCompleted(range, true);

  /* Das Protokoll liegt im localStorage; neu lesen, wenn die Seite wieder in
     den Vordergrund kommt (in der Zwischenzeit kann umgeplant worden sein). */
  const [log, setLog] = useState<RescheduleEntry[]>(() => loadReschedules());
  const [doneLog, setDoneLog] = useState<CompletionEntry[]>(() => loadCompletions());
  useEffect(() => {
    const reload = () => { setLog(loadReschedules()); setDoneLog(loadCompletions()); };
    window.addEventListener('focus', reload);
    return () => window.removeEventListener('focus', reload);
  }, []);
  useEffect(() => { setLog(loadReschedules()); setDoneLog(loadCompletions()); }, [snapshot.items]);
  const entries = useMemo(() => (demo ? demoReschedules(snapshot.items) : log), [demo, log, snapshot.items]);
  const completions = useMemo(() => (demo ? demoCompletions(completed) : doneLog), [demo, doneLog, completed]);

  const report = useMemo(() => buildReport({
    range, completed, previous, log: entries, completions,
    items: snapshot.items, projects: snapshot.projects, notes: snapshot.notes,
  }), [range, completed, previous, entries, completions, snapshot.items, snapshot.projects, snapshot.notes]);
  const doc = useMemo(() => reportDoc(report, t, locale, intl), [report, t, locale, intl]);

  const pickQuick = (next: QuickRange) => {
    if (next === 'custom') setCustom(range);
    setQuick(next);
  };
  const pickBound = (bound: 'since' | 'until', value: string) => {
    const at = new Date(`${value}T00:00:00`);
    if (Number.isNaN(at.getTime())) return;
    const end = new Date(`${value}T23:59:59.999`);
    setCustom(bound === 'since'
      ? { since: at, until: range.until < at ? end : range.until }
      : { since: range.since > at ? at : range.since, until: end });
    setQuick('custom');
  };

  const [busy, setBusy] = useState<'md' | 'pdf' | null>(null);
  const desktop = window.enhancedDesktop?.report;
  const saved = (result: { ok: boolean; path?: string; cancelled?: boolean }) => {
    if (result.ok && result.path) {
      const path = result.path;
      toast(t('report.saved', { file: path.split('/').pop() ?? path }));
      void desktop?.reveal(path);
    } else if (!result.cancelled) toast(t('report.saveFailed'), undefined, { tone: 'error' });
  };
  async function exportMarkdown() {
    const md = reportMarkdown(doc, t);
    const name = reportFileName(doc);
    if (desktop) {
      setBusy('md');
      try { saved(await desktop.saveMarkdown(name, md)); } catch { saved({ ok: false }); } finally { setBusy(null); }
      return;
    }
    const url = URL.createObjectURL(new Blob([md], { type: 'text/markdown;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `${name}.md`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  async function exportPdf() {
    const html = reportHtml(doc, t, locale);
    if (desktop) {
      setBusy('pdf');
      try { saved(await desktop.savePdf(reportFileName(doc), html)); } catch { saved({ ok: false }); } finally { setBusy(null); }
      return;
    }
    // Im Browser: die Seite in einem eigenen Fenster drucken („Als PDF sichern“).
    const win = window.open('', '_blank');
    if (!win) return;
    win.document.write(html);
    win.document.close();
    win.focus();
    win.print();
  }

  const c = report.completed;
  const perDay: BarDatum[] = useMemo(() => {
    const best = Math.max(0, ...c.byDay.map((d) => d.count));
    const short = c.byDay.length <= 14;
    const fmt = new Intl.DateTimeFormat(intl, short ? { weekday: 'short', day: 'numeric' } : { day: 'numeric', month: 'numeric' });
    return c.byDay.map((d) => ({
      key: d.date, label: fmt.format(new Date(`${d.date}T00:00:00`)), value: d.count, current: best > 0 && d.count === best,
    }));
  }, [c.byDay, intl]);
  const asBars = (rows: Array<{ label: string; value: number }>): BarDatum[] => {
    const best = Math.max(0, ...rows.map((r) => r.value));
    return rows.map((r) => ({ key: r.label, label: r.label, value: r.value, current: best > 0 && r.value === best }));
  };
  const tm = doc.timing;
  const percent = (value: number) => `${value} %`;
  const openIds = new Set(report.moves.top.filter((m) => m.state === 'open').map((m) => m.taskId));

  return (
    <div className="page wide report-page">
      <div className="phead">
        <div>
          <h1 className="ptitle">{t('report.title')}</h1>
          <p className="psub">{t('report.sub')}</p>
        </div>
        <div className="pactions">
          <button className="btn" disabled={busy !== null || loading} onClick={() => void exportMarkdown()}>
            <Icon name="file" size="sm" />{t('report.exportMd')}
          </button>
          <button className="btn primary" disabled={busy !== null || loading} onClick={() => void exportPdf()}>
            <Icon name="export" size="sm" />{t('report.exportPdf')}
          </button>
        </div>
      </div>

      <div className="viewbar report-rangebar">
        <div className="report-quick" role="group" aria-label={t('report.rangeLabel')}>
          {QUICK_RANGES.map((value) => (
            <button key={value} className={`chip${quick === value ? ' on' : ''}`} aria-pressed={quick === value} onClick={() => pickQuick(value)}>
              {t(`report.quick.${value}` as TranslationKey)}
            </button>
          ))}
        </div>
        <div className="report-rangeline">
          <span className="pagerlabel" aria-live="polite">{doc.rangeLabel}</span>
          {quick === 'custom' && (
            <span className="rangefields">
              <span className="rangefield">
                <span className="rangefield-label">{t('insights.from')}</span>
                <DateField value={toApiDate(range.since)} label={t('insights.from')} max={toApiDate(new Date())}
                  clearable={false} onChange={(next) => pickBound('since', next)} />
              </span>
              <span className="rangefield">
                <span className="rangefield-label">{t('insights.to')}</span>
                <DateField value={toApiDate(range.until)} label={t('insights.to')} min={toApiDate(range.since)}
                  clearable={false} onChange={(next) => pickBound('until', next)} />
              </span>
            </span>
          )}
        </div>
      </div>

      {loading && <p className="empty" role="status">{t('insights.loading')}</p>}
      {error !== null && (
        <div className="empty" role="alert">
          <p>{t(navigator.onLine === false ? 'insights.offline' : 'insights.failed')}</p>
          <button className="btn" onClick={retry}>{t('common.retry')}</button>
        </div>
      )}

      {!loading && error === null && (
        <>
          <div className="report-kpis">
            {doc.kpis.map((k) => <StatTile key={k.label} label={k.label} value={k.value} hint={k.hint} />)}
          </div>

          <div className="bento">
            <section className="card w12 report-analysis">
              <h3>{t('report.section.analysis')}</h3>
              <p>{doc.analysis.join(' ')}</p>
            </section>

            <section className="card w12">
              <h3>{t('report.section.learnings')}</h3>
              <div className="report-learnings">
                {doc.learnings.map((l) => (
                  <div key={l.title} className={`report-learning ${l.tone}`}>
                    <Icon name={l.tone === 'warn' ? 'warning' : l.tone === 'good' ? 'check' : 'sparkles'} size="sm" />
                    <div><strong>{l.title}</strong><p>{l.text}</p></div>
                  </div>
                ))}
              </div>
            </section>

            {perDay.length > 1 && (
              <ChartCard title={t('report.section.done')} span={12}>
                <Bars data={perDay} emptyLabel={t('report.empty.done')} labelEvery={perDay.length > 14 ? Math.ceil(perDay.length / 12) : 1} />
              </ChartCard>
            )}
            <ChartCard title={t('report.section.weekday')} span={6}>
              <Bars data={asBars(doc.byWeekday)} emptyLabel={t('report.empty.done')} />
            </ChartCard>
            <ChartCard title={t('report.section.slot')} span={6}>
              <Bars data={asBars(doc.bySlot.map((s) => ({ ...s, label: s.label.split(' (')[0] })))} emptyLabel={t('report.empty.done')} />
            </ChartCard>

            <section className="card w12 report-timing">
              <h3>{t('report.section.timing')}</h3>
              {tm.split.every((x) => x.value === 0)
                ? <p className="chart-empty">{t('report.empty.timing')}</p>
                : (
                  <>
                    <div className="report-timing-grid">
                      <div><Bars data={asBars(tm.split)} emptyLabel="" /></div>
                      {tm.clock.length > 0 && (
                        <div>
                          <h4>{t('report.section.timingClock')}</h4>
                          <Bars data={asBars(tm.clock)} emptyLabel="" />
                        </div>
                      )}
                    </div>
                    <div className="report-timing-grid">
                      {tm.byWeekday.length > 0 && (
                        <div>
                          <h4>{t('report.section.timingWeekday')}</h4>
                          <RankedBars data={tm.byWeekday.map((w) => ({ key: w.label, label: `${w.label} (${w.kept}/${w.planned})`, value: w.share }))}
                            format={percent} max={100} emptyLabel="" />
                        </div>
                      )}
                      {tm.byArea.length > 0 && (
                        <div>
                          <h4>{t('report.section.timingAreas')}</h4>
                          <RankedBars data={tm.byArea.map((a) => ({ key: a.label, label: `${a.label} (${a.kept}/${a.planned})`, value: a.share }))}
                            format={percent} max={100} emptyLabel="" />
                        </div>
                      )}
                    </div>
                    {tm.biggest.length > 0 && (
                      <>
                        <h4>{t('report.section.timingBiggest')}</h4>
                        <table className="report-table">
                          <thead>
                            <tr>
                              <th>{t('report.col.task')}</th><th>{t('report.col.planned')}</th>
                              <th>{t('report.col.doneAt')}</th><th className="n">{t('report.col.diff')}</th>
                            </tr>
                          </thead>
                          <tbody>
                            {tm.biggest.map((b, index) => (
                              <tr key={index}>
                                <td>{b.title}</td>
                                <td>{b.planned}{b.original && <div className="muted">{b.original}</div>}</td>
                                <td>{b.done}</td>
                                <td className="n"><span className={`report-count${b.late ? ' hot' : ''}`}>{b.diff}</span></td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </>
                    )}
                  </>
                )}
            </section>

            <section className="card w12">
              <h3>{t('report.section.moved')}</h3>
              {doc.moved.length === 0
                ? <p className="chart-empty">{t('report.empty.moved')}</p>
                : (
                  <table className="report-table">
                    <thead>
                      <tr>
                        <th>{t('report.col.task')}</th><th className="n">{t('report.col.moved')}</th>
                        <th className="n">{t('report.col.pushed')}</th><th>{t('report.col.state')}</th><th>{t('report.col.reasons')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {report.moves.top.slice(0, 10).map((m, index) => {
                        const row = doc.moved[index];
                        return (
                          <tr key={m.taskId}>
                            <td>
                              {openIds.has(m.taskId) && onOpen
                                ? <button className="report-link" onClick={() => onOpen(m.taskId)}>{row.title}</button>
                                : row.title}
                            </td>
                            <td className="n"><span className={`report-count${m.count >= 3 ? ' hot' : ''}`}>{m.count}×</span></td>
                            <td className="n">{row.pushed > 0 ? `+${row.pushed}` : '–'}</td>
                            <td><span className={`report-state ${m.state}`}>{row.state}</span></td>
                            <td className="report-reasons">{row.reasons.join('; ') || '–'}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
            </section>

            <ChartCard title={t('report.section.reasons')} span={6}>
              {doc.reasons.length === 0
                ? <p className="chart-empty">{t('report.empty.reasons')}</p>
                : <RankedBars data={doc.reasons.map((r) => ({ key: r.text, label: r.text, value: r.count }))} emptyLabel="" />}
            </ChartCard>
            <ChartCard title={t('report.section.areas')} span={6}>
              <RankedBars data={doc.byArea.map((a) => ({ key: a.label, label: a.label, value: a.value }))} emptyLabel={t('report.empty.done')} />
            </ChartCard>

            {doc.overdue.length > 0 && (
              <section className="card w6">
                <h3>{t('report.section.overdue')}</h3>
                <ul className="report-plain">
                  {report.open.oldest.map((o, index) => (
                    <li key={o.id}>
                      {onOpen ? <button className="report-link" onClick={() => onOpen(o.id)}>{doc.overdue[index].title}</button> : doc.overdue[index].title}
                      <span className="muted"> · {t('report.overdueDays', { days: o.days, count: o.days })}</span>
                    </li>
                  ))}
                </ul>
              </section>
            )}
            <section className={`card ${doc.overdue.length > 0 ? 'w6' : 'w12'}`}>
              <details className="report-done">
                <summary><h3>{t('report.section.doneList')} ({doc.done.length})</h3></summary>
                {doc.done.length === 0
                  ? <p className="chart-empty">{t('report.empty.done')}</p>
                  : <ul className="report-plain">{doc.done.map((d, i) => <li key={i}><span className="report-tick">✓</span> {d.title} <span className="muted">· {d.day}</span></li>)}</ul>}
              </details>
            </section>
          </div>
          <p className="psub report-note">{doc.note}</p>
        </>
      )}
    </div>
  );
}
