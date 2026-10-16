import { describe, expect, it } from 'vitest';
import { isHiddenLabel, isStatusLabel, labelsWithStatus, statusOf } from './kanban';

describe('Kanban-Status', () => {
  it('liest den Status aus Häkchen und Label', () => {
    expect(statusOf({ checked: false, labels: [] })).toBe('open');
    expect(statusOf({ checked: false, labels: ['Arbeit', 'StatusInArbeit'] })).toBe('doing');
    expect(statusOf({ checked: false, labels: ['statusinarbeit'] })).toBe('doing');
    expect(statusOf({ checked: true, labels: ['StatusInArbeit'] })).toBe('done');
    /* Wieder aufgemacht, aber das alte Label noch dran: offen. */
    expect(statusOf({ checked: false, labels: ['StatusAbgeschlossen'] })).toBe('open');
  });

  it('setzt genau ein Status-Label und lässt die anderen Tags stehen', () => {
    expect(labelsWithStatus(['Arbeit', 'StatusOffen', 'est-30'], 'doing'))
      .toEqual(['Arbeit', 'est-30', 'StatusInArbeit']);
    expect(labelsWithStatus([], 'open')).toEqual(['StatusOffen']);
  });

  it('blendet Status- und Schätz-Labels als Tags aus', () => {
    expect(isStatusLabel('StatusAbgeschlossen')).toBe(true);
    expect(isHiddenLabel('est-30')).toBe(true);
    expect(isHiddenLabel('StatusOffen')).toBe(true);
    expect(isHiddenLabel('Status')).toBe(false);
    expect(isHiddenLabel('Arbeit')).toBe(false);
  });
});
