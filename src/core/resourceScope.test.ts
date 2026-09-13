import { describe, expect, it } from 'vitest';
import {
  conflictInScope,
  listResources,
  projectConflicts,
  projectItems,
} from './resourceScope';
import { detectConflicts } from './conflicts';
import type { CueItem } from './types';

function cue(id: string, resource: string, startMs: number, endMs: number): CueItem {
  return { id, resource, startMs, endMs };
}

// 三项资源：灯光两条重叠（一处争用）、雾机两条重叠（一处争用）、升降台一条（无争用）。
// 资源码点序：升降台(U+5347) < 灯光(U+706F) < 雾机(U+96FE)。
const ITEMS: CueItem[] = [
  cue('LX-01', '灯光', 0, 120_000),
  cue('LX-02', '灯光', 60_000, 180_000),
  cue('FOG-01', '雾机', 90_000, 150_000),
  cue('FOG-02', '雾机', 120_000, 200_000),
  cue('LIFT-01', '升降台', 30_000, 210_000),
];

describe('listResources：资源名去重并按码点序排列', () => {
  it('按 Unicode 码点序返回去重资源名，与输入出现次序无关', () => {
    expect(listResources(ITEMS)).toEqual(['升降台', '灯光', '雾机']);
    expect(listResources([])).toEqual([]);
  });

  it('增补平面字符按码点而非 UTF-16 码元排序', () => {
    const items = [cue('a', '雾机\u{1F680}', 0, 1), cue('b', '雾机￿', 0, 1)];
    // U+FFFF < U+1F680（码点序），UTF-16 码元比较会给出相反结论
    expect(listResources(items)).toEqual(['雾机￿', '雾机\u{1F680}']);
  });
});

describe('projectItems / projectConflicts：确定性可见投影', () => {
  const conflicts = detectConflicts(ITEMS);

  it('null 范围原样返回同一数组（全场视图不复制、不改写）', () => {
    expect(projectItems(ITEMS, null)).toBe(ITEMS);
    expect(projectConflicts(conflicts, null)).toBe(conflicts);
  });

  it('指定范围只保留该资源的提示与争用，保持原次序与对象身份', () => {
    const items = projectItems(ITEMS, '灯光');
    expect(items.map((i) => i.id)).toEqual(['LX-01', 'LX-02']);
    expect(items[0]).toBe(ITEMS[0]);

    const scoped = projectConflicts(conflicts, '雾机');
    expect(scoped).toHaveLength(1);
    expect(scoped[0]).toBe(conflicts.find((c) => c.resource === '雾机'));
    // 投影不改写任何字段：绝对时刻与半开区间原样
    expect(scoped[0]).toEqual(conflicts.find((c) => c.resource === '雾机'));
  });

  it('无争用资源得到局部空投影；不存在的资源同样为空', () => {
    expect(projectConflicts(conflicts, '升降台')).toEqual([]);
    expect(projectItems(ITEMS, '升降台').map((i) => i.id)).toEqual(['LIFT-01']);
    expect(projectItems(ITEMS, '不存在')).toEqual([]);
    expect(projectConflicts(conflicts, '不存在')).toEqual([]);
  });

  it('投影不改动既有冲突排序（码点序原样穿过）', () => {
    const all = projectConflicts(conflicts, null);
    expect(all.map((c) => c.resource)).toEqual(['灯光', '雾机']);
    for (const scope of ['灯光', '雾机', '升降台']) {
      const scoped = projectConflicts(conflicts, scope);
      const expected = conflicts.filter((c) => c.resource === scope);
      expect(scoped).toEqual(expected);
    }
  });
});

describe('conflictInScope：范围切换时的选择同步判定', () => {
  const conflicts = detectConflicts(ITEMS);
  const lx = conflicts.find((c) => c.resource === '灯光')!;
  const fog = conflicts.find((c) => c.resource === '雾机')!;

  it('全部资源范围下任何争用都属于范围', () => {
    expect(conflictInScope(lx, null)).toBe(true);
    expect(conflictInScope(fog, null)).toBe(true);
  });

  it('指定范围只容纳本资源的争用', () => {
    expect(conflictInScope(lx, '灯光')).toBe(true);
    expect(conflictInScope(fog, '灯光')).toBe(false);
    expect(conflictInScope(fog, '雾机')).toBe(true);
  });
});
