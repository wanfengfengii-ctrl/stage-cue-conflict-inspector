import type { Conflict } from './types';
import { MS_PER_DAY } from './types';

/**
 * 聚焦上下文窗口（纯领域逻辑）。
 *
 * 排练中定位到某次设备争用后，舞台监督希望暂时收窄时间轴，只核对冲突前后各
 * {@link FOCUS_CONTEXT_PADDING_MS}（三十秒）内的上下游提示。窗口以争用交集为锚，
 * 向两侧等宽扩展，并限制在当天 [0, MS_PER_DAY] 范围内。
 *
 * 窗口仍是半开区间 [startMs, endMs)：窗口只负责“裁切显示区间”，不修改任何提示、
 * 冲突的真实起止，标签、排序与绝对毫秒值一律保持原样。
 */

/** 冲突交集两侧各保留的上下文宽度：三十秒。 */
export const FOCUS_CONTEXT_PADDING_MS = 30_000;

/** 聚焦窗口（半开）：已限制在当天范围内，且 startMs < endMs。 */
export interface FocusWindow {
  /** 窗口起点（含），毫秒。 */
  startMs: number;
  /** 窗口终点（不含），毫秒。 */
  endMs: number;
}

/**
 * 以争用交集为锚构建聚焦窗口：交集起止各向两侧扩三十秒，再夹到当天边界。
 *
 * 日界确定性：交集贴住 00:00 时窗口起点就是 0（不会出现负毫秒）；
 * 交集贴住 24:00（MS_PER_DAY）时窗口终点就是 MS_PER_DAY。
 * 同一冲突无论调用多少次，窗口起止严格一致（纯函数，无任何隐式状态）。
 */
export function createFocusWindow(anchor: Pick<Conflict, 'overlapStart' | 'overlapEnd'>): FocusWindow {
  return {
    startMs: Math.max(0, anchor.overlapStart - FOCUS_CONTEXT_PADDING_MS),
    endMs: Math.min(MS_PER_DAY, anchor.overlapEnd + FOCUS_CONTEXT_PADDING_MS),
  };
}

/**
 * 半开区间 [start, end) 是否与半开窗口 [lo, hi) 相交（交集长度严格大于 0）。
 *
 * 与冲突判定同一套半开语义：end === lo 或 start === hi 的【恰好贴边】情形
 * 不算相交——恰好在窗口边界交接的提示不会出现在窗口内。
 */
export function intersectsRange(start: number, end: number, lo: number, hi: number): boolean {
  return start < hi && end > lo;
}

/**
 * 把半开区间 [start, end) 裁到窗口 [lo, hi) 内，返回裁切后的显示区间。
 * 跨窗口边界的图形由此裁短；调用方应先用 {@link intersectsRange} 确认相交，
 * 完全不相交时返回 start === end 的空区间（半开语义下不占任何宽度）。
 */
export function clipRange(
  start: number,
  end: number,
  lo: number,
  hi: number,
): { start: number; end: number } {
  return { start: Math.max(start, lo), end: Math.min(end, hi) };
}
