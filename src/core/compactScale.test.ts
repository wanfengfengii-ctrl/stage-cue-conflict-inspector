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

describe('聚焦窗口：映射只覆盖窗口区间（投影确定性）', () => {
  // 提示分布在 01:00、05:00、20:00 三段（见 multiClusterItems）
  const win = { startMs: 3_570_000, endMs: 3_730_000 }; // 00:59:30 ~ 01:02:10

  it('整日模式 + 窗口：映射退化为窗口内等比例，窗口起止映射到 0 与窗口宽', () => {
    const scale = createTimeScale('day', multiClusterItems(), win);
    expect(scale.totalDisplay).toBe(win.endMs - win.startMs);
    expect(scale.compressedGaps).toHaveLength(0);
    expect(scale.toDisplay(win.startMs)).toBe(0);
    expect(scale.toDisplay(win.endMs)).toBe(win.endMs - win.startMs);
    // 窗口内 1 真实毫秒 = 1 显示毫秒
    expect(scale.toDisplay(win.startMs + 123)).toBe(123);
    expect(scale.toReal(123)).toBe(win.startMs + 123);
    expect(scale.fraction(win.startMs)).toBe(0);
    expect(scale.fraction(win.endMs)).toBe(1);
    expect(scale.fractionSpan(3_600_000, 3_601_000)).toBeCloseTo(1000 / 160_000, 10);
  });

  it('紧凑模式 + 窗口：只合并窗口内相交的占用，窗口外提示（05:00/20:00）不产生任何空档压缩', () => {
    const scale = createTimeScale('compact', multiClusterItems(), win);
    // 窗口内只有并集 3_600_000..3_700_000 一段；两侧短空档（各 30s）不压缩
    expect(scale.compressedGaps).toHaveLength(0);
    expect(scale.segments.map((s) => s.kind)).toEqual(['gap', 'occupied', 'gap']);
    expect(scale.segments[0]).toMatchObject({ realStart: 3_570_000, realEnd: 3_600_000 });
    expect(scale.segments[1]).toMatchObject({ realStart: 3_600_000, realEnd: 3_700_000 });
    expect(scale.segments[2]).toMatchObject({ realStart: 3_700_000, realEnd: 3_730_000 });
    expect(scale.totalDisplay).toBe(win.endMs - win.startMs);
  });

  it('跨窗口边界的占用并集被裁进窗口：锚冲突交集恰在边界贴边（半开）时投影确定', () => {
    // 占用 a 跨左缘、b 完全在内；合并后并集 [3_500_000, 3_700_000)，裁到窗口为 [3_570_000, 3_700_000)
    const items = [cue('a', 3_500_000, 3_620_000), cue('b', 3_620_000, 3_700_000)];
    const scale = createTimeScale('compact', items, win);
    const occupied = scale.segments.filter((s) => s.kind === 'occupied');
    expect(occupied).toHaveLength(1);
    expect(occupied[0]).toMatchObject({ realStart: 3_570_000, realEnd: 3_700_000 });
    // 恰好贴边窗口左缘的提示（end === win.start）不进入并集
    const touching = [...items, cue('t', 3_000_000, win.startMs)];
    const scale2 = createTimeScale('compact', touching, win);
    expect(scale2.segments).toEqual(scale.segments);
  });

  it('窗口内长空档照常压缩，窗口外的日首/日尾空档不再出现', () => {
    // 窗口 00:59:30..01:06:00：窗口内占用 01:00..01:01:40 与 01:05:20.001..01:05:30，
    // 中间空档 01:01:40..01:05:20.001 = 310_001ms（严格超过五分钟）被压缩；
    // 窗口两侧各 30 秒短空档保持等比例，窗口外不再有日首/日尾长空档。
    const items = [cue('a', 3_600_000, 3_610_000), cue('b', 3_920_001, 3_930_000)];
    const w = { startMs: 3_570_000, endMs: 3_960_000 };
    const scale = createTimeScale('compact', items, w);
    expect(scale.compressedGaps).toHaveLength(1);
    expect(scale.compressedGaps[0]).toMatchObject({ realStart: 3_610_000, realEnd: 3_920_001 });
    expect(scale.compressedGaps[0].displayEnd - scale.compressedGaps[0].displayStart).toBe(
      COMPRESSED_GAP_DISPLAY_MS,
    );
    // 首尾分段严格停在窗口边界，而不是 0 / MS_PER_DAY
    expect(scale.segments[0].realStart).toBe(w.startMs);
    expect(scale.segments[scale.segments.length - 1].realEnd).toBe(w.endMs);
  });

  it('日界窗口 [0, x) 与 (x, MS_PER_DAY] 下投影边界确定且可往返', () => {
    const fromMidnight = { startMs: 0, endMs: 60_000 };
    const s1 = createTimeScale('day', multiClusterItems(), fromMidnight);
    expect(s1.toDisplay(0)).toBe(0);
    expect(s1.toDisplay(60_000)).toBe(60_000);
    expect(s1.totalDisplay).toBe(60_000);

    const toMidnight = { startMs: MS_PER_DAY - 60_000, endMs: MS_PER_DAY };
    const s2 = createTimeScale('compact', multiClusterItems(), toMidnight);
    expect(s2.toDisplay(toMidnight.startMs)).toBe(0);
    expect(s2.toDisplay(MS_PER_DAY)).toBe(60_000);
    expect(s2.toReal(s2.toDisplay(MS_PER_DAY))).toBeCloseTo(MS_PER_DAY, 6);
  });

  it('同一窗口与输入重复构建结果完全一致（确定性）', () => {
    const a = createTimeScale('compact', multiClusterItems(), win);
    const b = createTimeScale('compact', multiClusterItems(), { ...win });
    expect(b.segments).toEqual(a.segments);
    expect(b.totalDisplay).toBe(a.totalDisplay);
  });
});
