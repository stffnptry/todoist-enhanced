import { useState } from 'react';
import { useStore } from '@/store/store';
import { newListLabel } from '@/domain/lists';

/**
 * Eine neue Liste in einem Bereich. Die Liste ist ein Label in Todoist; das
 * Anlegen legt es direkt an, ohne dass eine Aufgabe darin sein muss.
 */
export function useCreateList(area: string, name: string) {
  const labels = useStore((s) => s.snapshot.labels);
  const createLabel = useStore((s) => s.createLabel);
  const [busy, setBusy] = useState(false);
  const label = newListLabel(area, name);
  const available = Boolean(label && !Object.values(labels).some((l) => !l.is_deleted && l.name.toLowerCase() === label));
  async function create(): Promise<string | null> {
    if (!label || !available || busy) return null;
    setBusy(true);
    try {
      await createLabel(label);
      return label;
    } finally { setBusy(false); }
  }
  return { label, available, busy, create };
}
