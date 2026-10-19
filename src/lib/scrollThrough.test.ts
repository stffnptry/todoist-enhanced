import { describe, expect, it } from 'vitest';
import { scrollTarget, wheelPixels, type ScrollBox } from './scrollThrough';

type Box = ScrollBox & { overflow: string; parentElement: Box | null };
const box = (over: Partial<Box>, parent: Box | null = null): Box => ({
  scrollTop: 0, scrollLeft: 0, scrollHeight: 100, scrollWidth: 100,
  clientHeight: 100, clientWidth: 100, overflow: 'visible', parentElement: parent, ...over,
});
const of = (b: Box) => b.overflow;

describe('scrollTarget', () => {
  it('finds the nearest scrolling ancestor', () => {
    const page = box({ scrollHeight: 2000, overflow: 'visible' });
    const list = box({ scrollHeight: 900, clientHeight: 300, overflow: 'auto' }, page);
    const row = box({}, list);
    expect(scrollTarget(row, 'y', 40, of, page)).toBe(list);
  });

  it('passes a box already at its end on to the next one', () => {
    const page = box({ scrollHeight: 2000, overflow: 'visible' });
    const list = box({ scrollHeight: 900, clientHeight: 300, scrollTop: 600, overflow: 'auto' }, page);
    expect(scrollTarget(list, 'y', 40, of, page)).toBe(page);
    expect(scrollTarget(list, 'y', -40, of, page)).toBe(list);
  });

  it('skips boxes that hide their overflow, and a hidden page', () => {
    const page = box({ scrollHeight: 2000, overflow: 'hidden' });
    const clip = box({ scrollHeight: 900, overflow: 'hidden' }, page);
    expect(scrollTarget(clip, 'y', 40, of, page)).toBeNull();
  });

  it('looks along the axis asked for', () => {
    const grid = box({ scrollWidth: 1400, clientWidth: 700, overflow: 'auto' });
    expect(scrollTarget(grid, 'x', 30, of, null)).toBe(grid);
    expect(scrollTarget(grid, 'y', 30, of, null)).toBeNull();
    expect(scrollTarget(grid, 'x', 0, of, null)).toBeNull();
  });
});

describe('wheelPixels', () => {
  it('turns lines and pages into pixels', () => {
    expect(wheelPixels(3, 0, 800)).toBe(3);
    expect(wheelPixels(3, 1, 800)).toBe(48);
    expect(wheelPixels(1, 2, 800)).toBe(800);
  });
});
