import { describe, expect, it } from 'vitest';
import {
  COMPRESSED_GAP_DISPLAY_MS,
  GAP_COMPRESS_THRESHOLD_MS,
  createTimeScale,
  mergeOccupied,
} from './compactScale';
import type { CueItem } from './types';
import { MS_PER_DAY } from './types';

function cue(id: string, startMs: number, endMs: number, resource = 'R'): CueItem {
  return { id, resource, startMs, endMs };
}

/**
 * 三段排练片段（01:00 / 05:00 / 20:00 起），段间与日尾均为长空档；
 * 同一片段内跨资源占用会被合并为一个并集。
 */
function multiClusterItems(): CueItem[] {
  return [
    cue('a', 3_600_000, 3_660_000, '灯光'),
    cue('b', 3_620_000, 3_700_000, '雾机'), // 与 a 跨资源重叠，合并后 3_600_000..3_700_000
    cue('c', 18_000_000, 18_060_000),
    cue('d', 72_000_000, 72_100_000),
  ];
}

describe('mergeOccupied', () => {
  it('跨所有资源合并重叠与贴边占用', () => {
    const merged = mergeOccupied(multiClusterItems());
    expect(merged).toEqual([
      { start: 3_600_000, end: 3_700_000 },
      { start: 18_000_000, end: 18_060_000 },
      { start: 72_000_000, end: 72_100_000 },
    ]);
  });

  it('贴边（end === start）不产生空档', () => {
    const merged = mergeOccupied([cue('a', 0, 100), cue('b', 100, 200)]);
    expect(merged).toEqual([{ start: 0, end: 200 }]);
  });
});

describe('整日模式', () => {
  it('整段等比例且日界映射到 0 与全天宽', () => {
    const scale = createTimeScale('day', multiClusterItems());
    expect(scale.totalDisplay).toBe(MS_PER_DAY);
    expect(scale.compressedGaps).toHaveLength(0);
    expect(scale.segments).toHaveLength(1);
    expect(scale.toDisplay(0)).toBe(0);
    expect(scale.toDisplay(MS_PER_DAY)).toBe(MS_PER_DAY);
    expect(scale.toDisplay(43_200_000)).toBe(43_200_000);
    expect(scale.fraction(MS_PER_DAY / 2)).toBeCloseTo(0.5, 10);
    expect(scale.toReal(43_200_000)).toBe(43_200_000);
  });
});

describe('紧凑模式：多段长空档', () => {
  const scale = createTimeScale('compact', multiClusterItems());

  it('四处长空档（日首 + 两段间 + 日尾）全部压缩为固定三十秒显示宽', () => {
    expect(scale.compressedGaps).toHaveLength(4);
    for (const gap of scale.compressedGaps) {
      expect(gap.displayEnd - gap.displayStart).toBe(COMPRESSED_GAP_DISPLAY_MS);
      expect(gap.realEnd - gap.realStart).toBeGreaterThan(GAP_COMPRESS_THRESHOLD_MS);
    }
    expect(scale.compressedGaps.map((g) => g.realStart)).toEqual([
      0,
      3_700_000,
      18_060_000,
      72_100_000,
    ]);
    expect(scale.compressedGaps.map((g) => g.realEnd)).toEqual([
      3_600_000,
      18_000_000,
      72_000_000,
      MS_PER_DAY,
    ]);
  });

  it('坐标在多段长压缩下保持严格单调（分段首尾、压缩档内部、跨档）', () => {
    const probes: number[] = [
      0, 1, 3_599_999, 3_600_000, 3_650_000, 3_700_000, 3_700_001,
      17_999_999, 18_000_000, 18_060_000, 72_000_000, 72_100_000,
      72_100_001, MS_PER_DAY - 1, MS_PER_DAY,
    ];
    const displays = probes.map((t) => scale.toDisplay(t));
    for (let i = 1; i < displays.length; i++) {
      expect(displays[i]).toBeGreaterThan(displays[i - 1]);
    }

    // 压缩档内部同样单调不减（压缩斜率极小但为正）
    const gap = scale.compressedGaps[1];
    const inner = [
      gap.realStart,
      gap.realStart + 1,
      gap.realStart + gap.realDuration / 3,
      gap.realStart + (2 * gap.realDuration) / 3,
      gap.realEnd,
    ].map((t) => scale.toDisplay(t));
    for (let i = 1; i < inner.length; i++) {
      expect(inner[i]).toBeGreaterThanOrEqual(inner[i - 1]);
      if (i > 1 && i < inner.length - 1) expect(inner[i]).toBeGreaterThan(inner[i - 1]);
    }
  });

  it('日界映射：0 → 0、MS_PER_DAY → totalDisplay，分段覆盖全天', () => {
    expect(scale.toDisplay(0)).toBe(0);
    expect(scale.toDisplay(MS_PER_DAY)).toBe(scale.totalDisplay);
    expect(scale.segments[0].realStart).toBe(0);
    expect(scale.segments[scale.segments.length - 1].realEnd).toBe(MS_PER_DAY);
    for (let i = 1; i < scale.segments.length; i++) {
      expect(scale.segments[i].realStart).toBe(scale.segments[i - 1].realEnd);
      expect(scale.segments[i].displayStart).toBe(scale.segments[i - 1].displayEnd);
    }
  });

  it('总显示宽 = 占用与短空档真实长度 + 长空档固定宽之和', () => {
    const occupiedReal =
      (3_700_000 - 3_600_000) + (18_060_000 - 18_000_000) + (72_100_000 - 72_000_000);
    expect(scale.totalDisplay).toBe(occupiedReal + 4 * COMPRESSED_GAP_DISPLAY_MS);
    // 压缩后总宽远小于全天
    expect(scale.totalDisplay).toBeLessThan(MS_PER_DAY / 100);
  });

  it('toReal 是 toDisplay 的确定性逆映射（占用段逐毫秒、空档分段插值）', () => {
    const samples = [
      0, 3_600_000, 3_600_001, 3_699_999, 3_700_000,
      18_000_000, 18_030_000, 18_060_000,
      72_000_000, 72_050_000, 72_100_000, MS_PER_DAY,
    ];
    for (const t of samples) {
      expect(scale.toReal(scale.toDisplay(t))).toBeCloseTo(t, 6);
    }
    // 压缩空档内部抽样往返
    const gap = scale.compressedGaps[2];
    for (let t = gap.realStart; t <= gap.realEnd; t += 1_234_567) {
      expect(scale.toReal(scale.toDisplay(t))).toBeCloseTo(t, 4);
    }
  });

  it('fraction 与 fractionSpan 均落在 [0,1] 且占用段内 1ms 争用宽度严格为正', () => {
    for (let t = 0; t <= MS_PER_DAY; t += 3_600_000) {
      const f = scale.fraction(t);
      expect(f).toBeGreaterThanOrEqual(0);
      expect(f).toBeLessThanOrEqual(1);
    }
    // 占用段保持等比例：1ms 真实争用恰占 1/totalDisplay
    const w = scale.fractionSpan(3_600_000, 3_600_001);
    expect(w).toBeGreaterThan(0);
    expect(w).toBeCloseTo(1 / scale.totalDisplay, 10);
  });
});

describe('紧凑模式：短空档不压缩', () => {
  it('恰好五分钟与小于五分钟的空档保持等比例（1ms = 1 显示毫秒）', () => {
    const items = [
      cue('a', 0, 100_000),
      // 空档 100_000..400_000 = 300_000ms，恰好 5 分钟，不压缩
      cue('b', 400_000, 500_000),
      // 空档 500_000..800_000 = 300_000ms，同样不压缩
      cue('c', 800_000, 900_000),
    ];
    const scale = createTimeScale('compact', items);
    // 日首为 0（无空档）；100_000..400_000 与 500_000..800_000 均为短空档
    const shortGaps = scale.segments.filter((s) => s.kind === 'gap' && !s.compressed);
    expect(shortGaps).toHaveLength(2);
    for (const g of shortGaps) {
      expect(g.displayEnd - g.displayStart).toBe(g.realEnd - g.realStart);
    }
    // 仅日尾（900_000..86_400_000）被压缩
    expect(scale.compressedGaps).toHaveLength(1);
    // 等比例段内坐标恒等
    expect(scale.toDisplay(250_000)).toBe(250_000);
    expect(scale.toDisplay(650_000)).toBe(650_000);
    expect(scale.totalDisplay).toBe(900_000 + COMPRESSED_GAP_DISPLAY_MS);
  });

  it('严格超过五分钟（300_001ms）才压缩，边界两侧行为确定', () => {
    const justOver = createTimeScale('compact', [cue('a', 0, 1000), cue('b', 301_001, 302_001)]);
    expect(justOver.compressedGaps.some((g) => g.realStart === 1000 && g.realEnd === 301_001)).toBe(true);

    const justAt = createTimeScale('compact', [cue('a', 0, 1000), cue('b', 301_000, 302_000)]);
    const middleGap = justAt.segments.find((s) => s.kind === 'gap' && s.realStart === 1000);
    expect(middleGap?.compressed).toBe(false);
  });
});

describe('紧凑模式：边界退化', () => {
  it('无占用时退化为整日映射', () => {
    const scale = createTimeScale('compact', []);
    expect(scale.mode).toBe('compact');
    expect(scale.totalDisplay).toBe(MS_PER_DAY);
    expect(scale.compressedGaps).toHaveLength(0);
  });

  it('占用贴满全天时没有任何空档与压缩', () => {
    const scale = createTimeScale('compact', [cue('a', 0, MS_PER_DAY)]);
    expect(scale.compressedGaps).toHaveLength(0);
    expect(scale.totalDisplay).toBe(MS_PER_DAY);
    expect(scale.segments).toHaveLength(1);
    expect(scale.segments[0].kind).toBe('occupied');
  });

  it('同一份输入多次构建结果完全一致（确定性）', () => {
    const a = createTimeScale('compact', multiClusterItems());
    const b = createTimeScale('compact', multiClusterItems());
    expect(b.segments).toEqual(a.segments);
    expect(b.compressedGaps).toEqual(a.compressedGaps);
    expect(b.totalDisplay).toBe(a.totalDisplay);
  });
});
