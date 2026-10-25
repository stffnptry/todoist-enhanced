import { useEffect, useState } from 'react';
import { Overlay } from './Overlay';
import { EstimateStorageChoice } from '../Choosers';
import { useStore } from '@/store/store';
import { useT } from '@/hooks/useT';
import { canStoreDurations } from '@/domain/estimates';
import { planEstimateConversion } from '@/domain/estimate-conversion';
import type { EstimateStorage } from '@/domain/types';

/** `upgraded`: das Konto ist gerade Pro geworden; vorgewählt ist dann die echte Dauer. */
export function EstimateStorageDialog({ open, onClose, onConvert, upgraded = false }: { open: boolean; onClose: () => void; onConvert: (target: EstimateStorage) => void; upgraded?: boolean }) {
  const { t } = useT();
  const user = useStore((s) => s.snapshot.user);
  const setPrefs = useStore((s) => s.setPrefs);
  const [choice, setChoice] = useState<EstimateStorage>('tag');
  const snapshot = useStore((s) => s.snapshot);
  const count = planEstimateConversion(Object.values(snapshot.items), choice).changes.length;
  const allowed = canStoreDurations(user);
  useEffect(() => { if (open) setChoice(upgraded ? 'duration' : 'tag'); }, [open, user?.id, upgraded]);
  return (
    <Overlay open={open} onClose={onClose} label={t('estimates.storage')} size="sm">
      <div className="sheet-head"><h2>{t('estimates.storage')}</h2></div>
      <div className="sheet-body">
        <p className="estimate-dialog-intro">{upgraded ? `${t('estimates.proIntro')} ${t('estimates.dialogIntro')}` : t('estimates.dialogIntro')}</p>
        <EstimateStorageChoice value={choice} allowed={allowed} onChange={setChoice} />
        {count > 0 && (choice === 'tag' || allowed) && <div className="estimate-conversion-offer"><p>{t('estimates.offer', { count })}</p><button className="btn" onClick={() => { setPrefs({ estimateStorage: choice }); onConvert(choice); onClose(); }}>{t('estimates.savePreview')}</button></div>}
      </div>
      <div className="sheet-foot">
        <button className="btn" onClick={onClose}>{t('common.close')}</button>
        <button className="btn primary" onClick={() => { setPrefs({ estimateStorage: choice === 'duration' && !allowed ? 'tag' : choice }); onClose(); }}>
          {t('estimates.confirm')}
        </button>
      </div>
    </Overlay>
  );
}
