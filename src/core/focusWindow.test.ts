import { describe, expect, it } from 'vitest';
import {
  FOCUS_CONTEXT_PADDING_MS,
  clipRange,
  createFocusWindow,
  intersectsRange,
} from './focusWindow';
import { MS_PER_DAY } from './types';

describe('createFocusWindow', () => {
  it('以交集为锚向两侧各扩三十秒', () => {
    const win = createFocusWindow({ overlapStart: 60_000, overlapEnd: 90_000 });
    expect(win).toEqual({ startMs: 30_000, endMs: 120_000 });
    expect(FOCUS_CONTEXT_PADDING_MS).toBe(30_000);
  });

  it('日界：交集贴住 00:00 时窗口起点夹到 0，不出现负毫秒', () => {
    const win = createFocusWindow({ overlapStart: 0, overlapEnd: 5_000 });
    expect(win).toEqual({ startMs: 0, endMs: 35_000 });
  });

  it('日界：交集贴住 24:00 时窗口终点夹到 MS_PER_DAY', () => {
    const win = createFocusWindow({ overlapStart: MS_PER_DAY - 1, overlapEnd: MS_PER_DAY });
    expect(win).toEqual({ startMs: MS_PER_DAY - 30_001, endMs: MS_PER_DAY });
  });

  it('日界：交集全天占用时窗口即全天 [0, MS_PER_DAY)', () => {
    const win = createFocusWindow({ overlapStart: 0, overlapEnd: MS_PER_DAY });
    expect(win).toEqual({ startMs: 0, endMs: MS_PER_DAY });
  });

  it('确定性：同一冲突重复投影得到完全相同的窗口（无隐式状态）', () => {
    const anchor = { overlapStart: 3_600_000, overlapEnd: 3_601_000 };
    const first = createFocusWindow(anchor);
    for (let i = 0; i < 10; i++) {
      expect(createFocusWindow(anchor)).toEqual(first);
    }
  });
});

describe('intersectsRange（与窗口同样的半开判定）', () => {
  const lo = 10_000;
  const hi = 40_000;

  it('真重叠：跨越、内含、部分穿出均算相交', () => {
    expect(intersectsRange(0, 20_000, lo, hi)).toBe(true); // 左侧穿入
    expect(intersectsRange(30_000, 50_000, lo, hi)).toBe(true); // 右侧穿出
    expect(intersectsRange(0, MS_PER_DAY, lo, hi)).toBe(true); // 跨越整窗
    expect(intersectsRange(15_000, 20_000, lo, hi)).toBe(true); // 完全在内
  });

  it('恰好贴边：end === lo 或 start === hi 不算相交（半开，长度为 0）', () => {
    expect(intersectsRange(0, lo, lo, hi)).toBe(false);
    expect(intersectsRange(hi, 50_000, lo, hi)).toBe(false);
  });

  it('1ms 交叠也算相交，逐毫秒可定位', () => {
    expect(intersectsRange(lo - 1, lo + 1, lo, hi)).toBe(true);
    expect(intersectsRange(hi - 1, hi + 1, lo, hi)).toBe(true);
  });
});

describe('clipRange（跨边界图形裁短，边界时刻不变）', () => {
  const lo = 10_000;
  const hi = 40_000;

  it('跨左边界：显示左缘裁到窗口起点，绝对右值不变', () => {
    expect(clipRange(0, 20_000, lo, hi)).toEqual({ start: 10_000, end: 20_000 });
  });

  it('跨右边界：显示右缘裁到窗口终点，绝对左值不变', () => {
    expect(clipRange(30_000, 50_000, lo, hi)).toEqual({ start: 30_000, end: 40_000 });
  });

  it('跨越整窗：裁成窗口本身', () => {
    expect(clipRange(0, MS_PER_DAY, lo, hi)).toEqual({ start: lo, end: hi });
  });

  it('完全在内：原样返回', () => {
    expect(clipRange(15_000, 20_000, lo, hi)).toEqual({ start: 15_000, end: 20_000 });
  });

  it('恰好贴边（不相交）：裁成空区间，不占宽度', () => {
    expect(clipRange(0, lo, lo, hi)).toEqual({ start: lo, end: lo });
    expect(clipRange(hi, 50_000, lo, hi)).toEqual({ start: hi, end: hi });
  });

  it('日界裁切：窗口为全天时任何合法区间原样返回', () => {
    expect(clipRange(0, MS_PER_DAY, 0, MS_PER_DAY)).toEqual({ start: 0, end: MS_PER_DAY });
    expect(clipRange(100, 200, 0, MS_PER_DAY)).toEqual({ start: 100, end: 200 });
  });
});
