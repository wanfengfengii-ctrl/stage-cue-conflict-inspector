import { describe, expect, it } from 'vitest';
import { momentFromFraction, occupancyAtMoment } from './momentCursor';
import { COMPRESSED_GAP_DISPLAY_MS, createTimeScale } from './compactScale';
import type { CueItem } from './types';
import { MS_PER_DAY } from './types';

function cue(id: string, startMs: number, endMs: number, resource = 'R'): CueItem {
  return { id, resource, startMs, endMs };
}

/**
 * 一段位于 01:00 的占用（前后均为超过五分钟的长空档）：
 * 紧凑映射 = 压缩空档 [0, 3_600_000) → 30_000 显示毫秒
 *           + 占用段 [3_600_000, 3_601_000) → 1_000 显示毫秒（1:1）
 *           + 压缩空档 [3_601_000, MS_PER_DAY) → 30_000 显示毫秒。
 */
const SPARSE_ITEMS = [cue('a', 3_600_000, 3_601_000)];
const SPARSE_TOTAL = 2 * COMPRESSED_GAP_DISPLAY_MS + 1_000;

describe('momentFromFraction：整日坐标反演', () => {
  const scale = createTimeScale('day', SPARSE_ITEMS);

  it('起止边界：0 → 0、1 → MS_PER_DAY、中点 → 半天', () => {
    expect(momentFromFraction(scale, 0)).toBe(0);
    expect(momentFromFraction(scale, 1)).toBe(MS_PER_DAY);
    expect(momentFromFraction(scale, 0.5)).toBe(MS_PER_DAY / 2);
  });

  it('越界落点夹到当天范围，非有限值落到 0', () => {
    expect(momentFromFraction(scale, -0.25)).toBe(0);
    expect(momentFromFraction(scale, 1.25)).toBe(MS_PER_DAY);
    expect(momentFromFraction(scale, Number.NaN)).toBe(0);
    expect(momentFromFraction(scale, Number.POSITIVE_INFINITY)).toBe(0);
  });
});

describe('momentFromFraction：紧凑轴压缩空档反演确定', () => {
  const scale = createTimeScale('compact', SPARSE_ITEMS);

  it('空档边界：压缩空档起点 → 0、终点 → 占用段真实起点', () => {
    expect(scale.totalDisplay).toBe(SPARSE_TOTAL);
    expect(momentFromFraction(scale, 0)).toBe(0);
    // 空档显示终点 30_000 / 61_000 处恰好还原为真实 3_600_000（01:00）
    expect(momentFromFraction(scale, COMPRESSED_GAP_DISPLAY_MS / SPARSE_TOTAL)).toBe(3_600_000);
  });

  it('压缩空档内部按压缩斜率还原：空档中点 → 真实空档中点', () => {
    // 显示 15_000（空档中点）→ 真实 1_800_000（00:30）
    expect(momentFromFraction(scale, 15_000 / SPARSE_TOTAL)).toBe(1_800_000);
    // 日尾空档内落点：显示 31_000 + 15_000 → 真实 3_601_000 + (86_400_000 - 3_601_000) / 2
    const tailMid = (COMPRESSED_GAP_DISPLAY_MS + 1_000 + 15_000) / SPARSE_TOTAL;
    expect(momentFromFraction(scale, tailMid)).toBe(3_601_000 + (MS_PER_DAY - 3_601_000) / 2);
  });

  it('占用段内 1 真实毫秒 = 1 显示毫秒，逐毫秒往返确定', () => {
    for (const t of [3_600_000, 3_600_001, 3_600_500, 3_600_999]) {
      expect(momentFromFraction(scale, scale.fraction(t))).toBe(t);
    }
    // 落点 1 → 日尾
    expect(momentFromFraction(scale, 1)).toBe(MS_PER_DAY);
  });

  it('同一落点重复反演结果完全一致（确定性）', () => {
    const f = 12_345 / SPARSE_TOTAL;
    const first = momentFromFraction(scale, f);
    for (let i = 0; i < 10; i++) {
      expect(momentFromFraction(scale, f)).toBe(first);
    }
  });
});

describe('momentFromFraction：聚焦窗口坐标反演', () => {
  const win = { startMs: 3_570_000, endMs: 3_730_000 };

  it('整日 + 窗口：0 → 窗口起点、1 → 窗口终点、中点 → 窗口中点', () => {
    const scale = createTimeScale('day', SPARSE_ITEMS, win);
    expect(momentFromFraction(scale, 0)).toBe(win.startMs);
    expect(momentFromFraction(scale, 1)).toBe(win.endMs);
    expect(momentFromFraction(scale, 0.5)).toBe((win.startMs + win.endMs) / 2);
  });

  it('紧凑 + 窗口：窗口内占用段逐毫秒往返，越界夹到窗口边界', () => {
    const scale = createTimeScale('compact', SPARSE_ITEMS, win);
    expect(momentFromFraction(scale, scale.fraction(3_600_123))).toBe(3_600_123);
    expect(momentFromFraction(scale, -1)).toBe(win.startMs);
    expect(momentFromFraction(scale, 2)).toBe(win.endMs);
  });
});

describe('occupancyAtMoment：半开区间占用判定', () => {
  // a、b 同资源贴边交接；c 跨资源与二者相交
  const items = [
    cue('b', 200, 300, '灯光'),
    cue('a', 100, 200, '灯光'),
    cue('c', 150, 250, '雾机'),
  ];

  it('恰在 startMs 已计入，恰在 endMs 已释放不计入', () => {
    expect(occupancyAtMoment(items, 100).flatMap((g) => g.cues.map((c) => c.id))).toEqual(['a']);
    // t=200：a 恰在 endMs 已释放，b 恰在 startMs 已占用，c 仍在
    const at200 = occupancyAtMoment(items, 200);
    expect(at200.map((g) => g.resource)).toEqual(['灯光', '雾机']);
    expect(at200[0]!.cues.map((c) => c.id)).toEqual(['b']);
    expect(at200[1]!.cues.map((c) => c.id)).toEqual(['c']);
    // t=300：b 也恰在 endMs，全部释放
    expect(occupancyAtMoment(items, 300)).toEqual([]);
  });

  it('按 resource 码点序分组、组内按 id 码点序排列', () => {
    const at200 = occupancyAtMoment(items, 200);
    // 灯光（U+706F）排在雾机（U+96FE）之前
    expect(at200.map((g) => g.resource)).toEqual(['灯光', '雾机']);

    const many = [
      cue('z', 0, 1000, 'R'),
      cue('A', 0, 1000, 'R'),
      cue('a', 0, 1000, 'R'),
    ];
    const groups = occupancyAtMoment(many, 500);
    expect(groups).toHaveLength(1);
    // 码点序：'A'(65) < 'a'(97) < 'z'(122)
    expect(groups[0]!.cues.map((c) => c.id)).toEqual(['A', 'a', 'z']);
  });

  it('日界：0 时刻占用计入，MS_PER_DAY 时刻任何提示都不计入', () => {
    const edges = [cue('dawn', 0, 100), cue('dusk', MS_PER_DAY - 100, MS_PER_DAY)];
    expect(occupancyAtMoment(edges, 0).flatMap((g) => g.cues.map((c) => c.id))).toEqual(['dawn']);
    expect(occupancyAtMoment(edges, MS_PER_DAY)).toEqual([]);
    expect(occupancyAtMoment([], 0)).toEqual([]);
  });

  it('压缩空档内的真实时刻无任何占用（与紧凑轴落点反演衔接）', () => {
    // 空档 [0, 3_600_000) 被压缩；落在其中的游标时刻（如 00:30）必然无占用
    const scale = createTimeScale('compact', SPARSE_ITEMS);
    const inGap = momentFromFraction(scale, 15_000 / SPARSE_TOTAL);
    expect(inGap).toBe(1_800_000);
    expect(occupancyAtMoment(SPARSE_ITEMS, inGap)).toEqual([]);
    // 占用段内落点则命中该提示
    const inCue = momentFromFraction(scale, scale.fraction(3_600_500));
    expect(occupancyAtMoment(SPARSE_ITEMS, inCue).flatMap((g) => g.cues.map((c) => c.id))).toEqual(['a']);
  });

  it('确定性：同一输入重复查询结果完全一致', () => {
    const first = occupancyAtMoment(items, 200);
    for (let i = 0; i < 10; i++) {
      expect(occupancyAtMoment(items, 200)).toEqual(first);
    }
  });
});
