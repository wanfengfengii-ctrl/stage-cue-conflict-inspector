import { describe, expect, it } from 'vitest';
import { pickOverlap } from './overlapHit';
import type { OverlapHit } from './overlapHit';

const hit = (
  key: string,
  realLeft: number,
  realWidth: number,
  hotWidth = realWidth,
): OverlapHit => ({
  key,
  realLeft,
  realWidth,
  // 与视图一致：最小热区只向右扩，不改变左缘
  hotLeft: realLeft,
  hotWidth,
});

describe('pickOverlap', () => {
  it('点击落在唯一热区上时选中该争用，再次点击取消', () => {
    const hits = [hit('c1', 100, 10)];
    expect(pickOverlap(hits, 105, null)).toBe('c1');
    expect(pickOverlap(hits, 105, 'c1')).toBeNull();
  });

  it('坐标不在任何热区内时返回 undefined，由调用方退回元素自身语义', () => {
    const hits = [hit('c1', 100, 10)];
    expect(pickOverlap(hits, 50, null)).toBeUndefined();
  });

  it('三组争用完全重叠：同一点逐组轮换选择，三组都能被选中，最后再点取消', () => {
    // 同一设备三条提示完全重叠：三个标记盒（含热区）几何完全一致，叠在同一区域
    const hits = [hit('c1', 100, 4), hit('c2', 100, 4), hit('c3', 100, 4)];
    // 无论浏览器把点击交给哪个叠放的按钮，解析都在同组候选上进行：
    expect(pickOverlap(hits, 102, null)).toBe('c1');
    expect(pickOverlap(hits, 102, 'c1')).toBe('c2');
    expect(pickOverlap(hits, 102, 'c2')).toBe('c3');
    expect(pickOverlap(hits, 102, 'c3')).toBeNull();
  });

  it('紧凑轴相邻 1ms 争用扩展热区互相覆盖：点前一个的可见中心选中前一个', () => {
    // 真实交集宽 1px（亚像素），热区向右扩到 6px：
    // c1 热区 [200,206]，c2 热区 [201,207]，覆盖区 [201,206]
    const hits = [hit('c1', 200, 1, 6), hit('c2', 201, 1, 6)];
    // Playwright/用户点前一个标记的中心（203）：旧实现会被后一个（DOM 上层）截获
    expect(pickOverlap(hits, 203, null)).toBe('c1');
    // 点后一个的中心（204）选中后一个
    expect(pickOverlap(hits, 204, null)).toBe('c2');
  });

  it('点在真实交集上时，任何扩展热区都不能把归属抢走', () => {
    // 左侧标记真实交集 [200,201]，其扩展热区与右侧标记热区重叠
    const hits = [hit('c1', 200, 1, 6), hit('c2', 201, 1, 6)];
    expect(pickOverlap(hits, 200.5, null)).toBe('c1');
    expect(pickOverlap(hits, 201.5, null)).toBe('c2');
  });

  it('选中另一组后点击当前组真实交集：直接改选到所指向的组，而非简单轮换', () => {
    const hits = [hit('c1', 200, 1, 6), hit('c2', 201, 1, 6)];
    // 当前选中 c1，点 c2 的真实交集 → 改选 c2（归属与用户指向一致）
    expect(pickOverlap(hits, 201.5, 'c1')).toBe('c2');
  });

  it('非重叠热区互不干扰', () => {
    const hits = [hit('c1', 0, 10), hit('c2', 100, 10)];
    expect(pickOverlap(hits, 5, null)).toBe('c1');
    expect(pickOverlap(hits, 105, null)).toBe('c2');
  });
});
