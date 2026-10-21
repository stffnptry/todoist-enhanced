import { useState } from 'react';
import { Overlay } from './Overlay';
import { Icon } from '../Icon';
import { useT } from '@/hooks/useT';
import { useStore } from '@/store/store';
import { dueDate, formatDayOrName } from '@/domain/dates';
import { renderTitle } from '@/domain/markdown';
import { displayTaskContent, type Item } from '@/domain/types';
import { NOT_DONE_MARK } from '@/domain/notDone';

/**
 * Rechtsklick → „Nicht erledigt …“: Die Aufgabe ist vom Tisch, ohne getan zu
 * sein. Nur mit Grund; der kommt als Kommentar an die Aufgabe, dann wird sie
 * in Todoist abgehakt (domain/notDone.ts). Der Report führt sie getrennt.
 */
export function NotDoneDialog({ item, onClose }: { item: Item; onClose: () => void }) {
  const { t, locale } = useT();
  const snapshot = useStore((s) => s.snapshot);
  const dateFormat = useStore((s) => s.prefs.dateFormat);
  const markNotDone = useStore((s) => s.markNotDone);
  const toast = useStore((s) => s.toast);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  const was = dueDate(item);
  const project = snapshot.projects[item.project_id]?.name;
  const recurring = Boolean(item.due?.is_recurring);

  async function confirm() {
    if (busy || !reason.trim()) return;
    setBusy(true);
    try {
      if (await markNotDone(item.id, reason)) {
        toast(t('notDone.marked'));
        onClose();
      } else {
        toast(t('notDone.commentFailed'), undefined, { tone: 'error' });
      }
    } finally { setBusy(false); }
  }

  return (
    <Overlay open onClose={onClose} label={t('notDone.title')} size="sm">
      <div className="sheet-head">
        <h2>{t('notDone.title')}</h2>
        <button className="iconbtn" aria-label={t('common.close')} onClick={onClose}>
          <Icon name="close" />
        </button>
      </div>
      <div className="sheet-body replan-body">
        <div className="replan-task">
          <p className="replan-name" dangerouslySetInnerHTML={{ __html: renderTitle(displayTaskContent(item)) }} />
          <p className="replan-meta">
            {was && <span><Icon name="calendar" size="sm" />{formatDayOrName(was, locale, dateFormat)}</span>}
            {recurring && <span><Icon name="repeat" size="sm" />{t('replan.recurring')}</span>}
            {project && <span><Icon name="project" size="sm" />{project}</span>}
          </p>
        </div>
        <label className="replan-reason">
          <span className="fieldlabel">
            <span className="replan-mark notdone-mark" aria-hidden="true">{NOT_DONE_MARK}</span>
            {t('notDone.reason')}
          </span>
          <textarea
            data-autofocus
            rows={3}
            value={reason}
            placeholder={t('notDone.reasonPlaceholder')}
            onChange={(e) => setReason(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void confirm(); }
            }}
          />
          <span className="replan-hint">{t('notDone.hint')}</span>
        </label>
        {recurring && (
          <p className="replan-hint replan-children">
            <Icon name="repeat" size="sm" />
            {t('notDone.recurringHint')}
          </p>
        )}
      </div>
      <div className="sheet-foot">
        <button className="btn quiet" disabled={busy} onClick={onClose}>{t('common.cancel')}</button>
        <button className="btn primary" disabled={busy || !reason.trim()} onClick={() => void confirm()}>
          {t('notDone.confirm')}
        </button>
      </div>
    </Overlay>
  );
}
