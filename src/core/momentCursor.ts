import type { CueItem } from './types';
import { MS_PER_DAY } from './types';
import { compareByCodePoint } from './conflicts';
import type { TimeScale } from './compactScale';

/**
 * 时刻游标（纯领域逻辑）。
 *
 * 排练进行到某个时刻，舞台监督在时间轴刻度带上点击设置“时刻游标”，确认各设备
 * 此刻的实际占用者。本模块只做两件确定性的事：
 *   1. 坐标反演：把当前整日 / 紧凑 / 聚焦映射上的相对落点（[0,1] 比例坐标）
 *      反演为绝对毫秒——复用 TimeScale.toReal，映射本身不改写任何真实时刻；
 *   2. 占用判定：按半开区间 [startMs, endMs) 找出该时刻仍在占用的提示——
 *      startMs 时刻已在占用，endMs 时刻已释放（恰在 endMs 的提示不计入），
 *      再按 resource 分组、组内按 id 的 Unicode 码点序排列。
 *
 * 游标本体只是“未设置 / 已设置绝对毫秒”一个值，由 App 持有；这里不存任何状态。
 */

/** 某一资源在该时刻被占用的提示清单（组内按 id 码点序）。 */
export interface MomentOccupancy {
  resource: string;
  cues: CueItem[];
}

/**
 * 把刻度带上的相对落点（[0,1] 比例坐标）反演为绝对毫秒。
 *
 * 整日、紧凑、聚焦三种映射共用同一入口：比例 → 显示毫秒 → TimeScale.toReal。
 * 落点先夹到 [0,1]（紧凑轴右缘裁切、亚像素点击可能略越界），结果取整到毫秒
 * 并夹到当天 [0, MS_PER_DAY]；压缩空档内部按压缩斜率还原，同一落点无论调用
 * 多少次结果严格一致（纯函数）。
 */
export function momentFromFraction(scale: TimeScale, fraction: number): number {
  if (!Number.isFinite(fraction)) return 0;
  const clamped = Math.max(0, Math.min(1, fraction));
  const real = scale.toReal(clamped * scale.totalDisplay);
  return Math.max(0, Math.min(MS_PER_DAY, Math.round(real)));
}

/**
 * 找出 momentMs 时刻仍在占用设备的全部提示，按 resource 码点序分组、
 * 组内按 id 码点序排列；该时刻无任何占用时返回空数组。
 *
 * 半开区间 [startMs, endMs)：item.startMs <= momentMs < item.endMs。
 * 恰在 startMs 的提示已计入，恰在 endMs 的提示已释放、不计入——
 * 与冲突判定同一套半开语义，贴边交接不会被误报为占用。
 */
export function occupancyAtMoment(items: readonly CueItem[], momentMs: number): MomentOccupancy[] {
  const byResource = new Map<string, CueItem[]>();
  for (const item of items) {
    if (item.startMs <= momentMs && momentMs < item.endMs) {
      const list = byResource.get(item.resource);
      if (list) list.push(item);
      else byResource.set(item.resource, [item]);
    }
  }
  return [...byResource.entries()]
    .map(([resource, cues]) => ({
      resource,
      cues: [...cues].sort((a, b) => compareByCodePoint(a.id, b.id)),
    }))
    .sort((a, b) => compareByCodePoint(a.resource, b.resource));
}
