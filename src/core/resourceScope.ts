import type { Conflict, CueItem } from './types';
import { compareByCodePoint } from './conflicts';

/**
 * 资源范围（纯领域逻辑）。
 *
 * 设备提示较多时，舞台监督需要先隔离某一项资源，核对该资源的全部占用与争用，
 * 再恢复全场视图继续排查。范围只对【已通过校验的 CueItem】与【既有 Conflict】
 * 建立确定性可见投影：
 *   - 投影只做“是否进入视图”的取舍——不改写任何提示、不改写冲突排序、
 *     不改写绝对毫秒值、不改写半开区间判定，也不改写冲突的选择身份
 *     （投影内外都是同一批 Conflict 对象，conflictKey 不变）；
 *   - 列表与时间轴消费同一份投影结果，两侧看到的始终是同一范围。
 *
 * 本模块不存任何状态：App 只保存“全部资源（null）/ 指定资源（资源名）”
 * 这一组范围值，投影由这里的纯函数按当前结果即时派生。
 */

/** 范围状态：null = 全部资源；否则只呈现该资源名对应的提示与争用。 */
export type ResourceScope = string | null;

/**
 * 当前批次中出现过的全部资源名，按 Unicode 码点序去重排列。
 * 供范围选择入口（下拉 / 时间轴资源名）使用，同一批输入结果确定可复现。
 */
export function listResources(items: readonly CueItem[]): string[] {
  const seen = new Set<string>();
  for (const item of items) seen.add(item.resource);
  return [...seen].sort(compareByCodePoint);
}

/**
 * 提示投影：范围内（或全部）的提示，保持原数组次序与对象身份。
 * null 范围直接返回原数组——全场视图不做任何复制或改写。
 */
export function projectItems(items: CueItem[], scope: ResourceScope): CueItem[] {
  if (scope === null) return items;
  return items.filter((item) => item.resource === scope);
}

/**
 * 争用投影：范围内（或全部）的争用，保持既有排序与 Conflict 对象身份
 * （选择身份键 conflictKey 随对象一起穿过投影，列表选中态与时间轴高亮
 * 在范围切换前后仍指向同一争用）。
 */
export function projectConflicts(conflicts: Conflict[], scope: ResourceScope): Conflict[] {
  if (scope === null) return conflicts;
  return conflicts.filter((c) => c.resource === scope);
}

/**
 * 争用是否属于指定范围：范围切换时据此同步选择状态——
 * 不属于新范围的选中争用取消，属于（或回到全部资源）则原样保留。
 */
export function conflictInScope(conflict: Conflict, scope: ResourceScope): boolean {
  return scope === null || conflict.resource === scope;
}
