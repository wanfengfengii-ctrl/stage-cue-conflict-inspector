import type { CueItem } from './types';
import { MS_PER_DAY } from './types';
import type { FocusWindow } from './focusWindow';
import { intersectsRange } from './focusWindow';

/**
 * 紧凑时间轴的确定性分段映射。
 *
 * 全天提示集中在少数排练片段时，整日比例会把有效区间挤成一条线。紧凑模式：
 *   1. 先合并【所有资源】提示的半开占用区间 [startMs, endMs)，得到占用并集；
 *   2. 相邻占用之间（含日首/日尾）严格超过 {@link GAP_COMPRESS_THRESHOLD_MS} 的空档，
 *      映射为固定 {@link COMPRESSED_GAP_DISPLAY_MS} 的显示宽度（约三十秒）；
 *   3. 占用区间与短空档保持同一等比例（1 真实毫秒 = 1 显示毫秒）。
 *
 * 映射只做坐标换算：不修改任何提示、不参与冲突排序、不改变半开区间判定。
 * 坐标单位是“显示毫秒”（虚拟时间），由视图层自行决定像素比例
 * （紧凑模式 1 显示毫秒 = 1px，因此 1ms 的真实争用在时间轴上仍可逐毫秒点中）。
 */

export type TimelineMode = 'day' | 'compact';

/** 空档严格大于五分钟才压缩；恰好五分钟属于短空档，保持等比例。 */
export const GAP_COMPRESS_THRESHOLD_MS = 5 * 60_000;

/** 被压缩空档的固定显示宽度，按同一比例尺折算即“三十秒”。 */
export const COMPRESSED_GAP_DISPLAY_MS = 30_000;

/** 映射的一个分段：分段首尾相接，完整覆盖 [0, MS_PER_DAY]。 */
export interface ScaleSegment {
  /** occupied = 提示占用并集；gap = 两段占用之间（含日首/日尾）的空档。 */
  kind: 'occupied' | 'gap';
  /** 真实起点（含），毫秒。 */
  realStart: number;
  /** 真实终点（不含），毫秒。 */
  realEnd: number;
  /** 显示起点（含），显示毫秒。 */
  displayStart: number;
  /** 显示终点（不含），显示毫秒。 */
  displayEnd: number;
  /** 该段空档是否被压缩；占用段恒为 false。 */
  compressed: boolean;
}

/** 一处被压缩的长空档，供视图绘制断轴标记与真实起止标注。 */
export interface CompressedGap {
  realStart: number;
  realEnd: number;
  realDuration: number;
  displayStart: number;
  displayEnd: number;
}

export interface TimeScale {
  mode: TimelineMode;
  /** 有序且首尾相接的分段，覆盖整个 [0, MS_PER_DAY]。 */
  segments: ScaleSegment[];
  /** 紧凑模式下被压缩的长空档（按真实起点升序）；整日模式为空。 */
  compressedGaps: CompressedGap[];
  /** 全天映射后的总显示宽度（显示毫秒）。 */
  totalDisplay: number;
  /** 真实毫秒 → 显示毫秒（分段线性，连续单调不减）。 */
  toDisplay(ms: number): number;
  /** 显示毫秒 → 真实毫秒（toDisplay 的逆映射；压缩空档内部按压缩斜率还原）。 */
  toReal(displayMs: number): number;
  /** 真实毫秒 → [0,1] 比例坐标，供百分比布局使用。 */
  fraction(ms: number): number;
  /** 真实半开区间 [startMs, endMs) 在显示轴上占的比例宽度。 */
  fractionSpan(startMs: number, endMs: number): number;
}

/**
 * 合并所有资源的占用区间为不相交并集（与具体资源无关）。
 * 半开区间：贴边（前一段 end === 后一段 start）合并后空档为 0，
 * 不会因为“贴边交接”凭空造出空档。
 */
export function mergeOccupied(items: readonly CueItem[]): Array<{ start: number; end: number }> {
  const spans = items
    .map((item) => ({ start: item.startMs, end: item.endMs }))
    .sort((a, b) => a.start - b.start || a.end - b.end);

  const merged: Array<{ start: number; end: number }> = [];
  for (const span of spans) {
    const last = merged[merged.length - 1];
    if (last && span.start <= last.end) {
      if (span.end > last.end) last.end = span.end;
    } else {
      merged.push({ start: span.start, end: span.end });
    }
  }
  return merged;
}

function finishScale(
  mode: TimelineMode,
  segments: ScaleSegment[],
  compressedGaps: CompressedGap[],
): TimeScale {
  const totalDisplay = segments.length > 0 ? segments[segments.length - 1].displayEnd : 0;
  // 映射覆盖的真实区间：整日模式为 [0, MS_PER_DAY]，聚焦模式为聚焦窗口。
  const realMin = segments.length > 0 ? segments[0].realStart : 0;
  const realMax = segments.length > 0 ? segments[segments.length - 1].realEnd : MS_PER_DAY;

  const locate = (value: number, by: 'real' | 'display'): ScaleSegment => {
    // 分段有序且数量很小（长空档数量级），顺序查找即可，结果对同一输入确定性可复现。
    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i];
      const start = by === 'real' ? seg.realStart : seg.displayStart;
      const end = by === 'real' ? seg.realEnd : seg.displayEnd;
      if (value >= start && value < end) return seg;
    }
    // 恰好落在右边界（含 MS_PER_DAY / totalDisplay）：归入最后一段。
    const last = segments[segments.length - 1];
    if (last && value === (by === 'real' ? last.realEnd : last.displayEnd)) return last;
    return last;
  };

  const interpolate = (seg: ScaleSegment, value: number, fromDisplay: boolean): number => {
    const realSpan = seg.realEnd - seg.realStart;
    const displaySpan = seg.displayEnd - seg.displayStart;
    if (fromDisplay) {
      const ratio = (value - seg.displayStart) / displaySpan;
      return seg.realStart + ratio * realSpan;
    }
    const ratio = (value - seg.realStart) / realSpan;
    return seg.displayStart + ratio * displaySpan;
  };

  const toDisplay = (ms: number): number => {
    const clamped = Math.max(realMin, Math.min(realMax, ms));
    return interpolate(locate(clamped, 'real'), clamped, false);
  };

  const toReal = (displayMs: number): number => {
    const clamped = Math.max(0, Math.min(totalDisplay, displayMs));
    return interpolate(locate(clamped, 'display'), clamped, true);
  };

  return {
    mode,
    segments,
    compressedGaps,
    totalDisplay,
    toDisplay,
    toReal,
    fraction(ms: number) {
      return totalDisplay === 0 ? 0 : toDisplay(ms) / totalDisplay;
    },
    fractionSpan(startMs: number, endMs: number) {
      return totalDisplay === 0 ? 0 : (toDisplay(endMs) - toDisplay(startMs)) / totalDisplay;
    },
  };
}

/**
 * 整段等比例映射，1 真实毫秒 = 1 显示毫秒，无压缩（整日模式，或紧凑模式的退化情形）。
 * bounds 给出映射覆盖的真实半开区间：整日模式为全天 [0, MS_PER_DAY]，
 * 聚焦模式为聚焦窗口（窗口内仍按等比例，只覆盖该区间）。
 */
function buildFlatScale(mode: TimelineMode, bounds: FocusWindow = { startMs: 0, endMs: MS_PER_DAY }): TimeScale {
  const segment: ScaleSegment = {
    kind: 'gap',
    realStart: bounds.startMs,
    realEnd: bounds.endMs,
    displayStart: 0,
    displayEnd: bounds.endMs - bounds.startMs,
    compressed: false,
  };
  return finishScale(mode, [segment], []);
}

/**
 * 构建时间轴映射。
 *
 * @param mode 'day' 整日等比例；'compact' 压缩超过五分钟的相邻空档
 * @param items 已通过整批校验的全部提示（跨所有资源合并）
 * @param window 可选聚焦窗口：给定后映射只覆盖该半开区间（窗口内的提示并集与空档
 *               仍按同一规则构建），缺省覆盖全天。窗口只裁切显示区间，
 *               不改写任何真实时刻；紧凑压缩规则在窗口内照常生效。
 */
export function createTimeScale(
  mode: TimelineMode,
  items: readonly CueItem[],
  window?: FocusWindow,
): TimeScale {
  const lo = window?.startMs ?? 0;
  const hi = window?.endMs ?? MS_PER_DAY;

  if (mode === 'day') return buildFlatScale('day', { startMs: lo, endMs: hi });

  // 聚焦模式下只保留与窗口半开相交的提示（贴边交接不算），
  // 再让 mergeOccupied 按半开并集自然合并；整日模式 items 原样参与。
  const visibleItems = window ? items.filter((it) => intersectsRange(it.startMs, it.endMs, lo, hi)) : items;
  const occupiedAll = mergeOccupied(visibleItems);

  // 把占用并集裁进窗口：与窗口半开相交的段保留，裁掉窗外部分。
  const occupied = occupiedAll
    .filter((span) => intersectsRange(span.start, span.end, lo, hi))
    .map((span) => ({ start: Math.max(span.start, lo), end: Math.min(span.end, hi) }));

  // 窗口内没有任何占用时退化为等比例映射（覆盖窗口本身），避免把整窗压成三十秒。
  if (occupied.length === 0) return buildFlatScale('compact', { startMs: lo, endMs: hi });

  const segments: ScaleSegment[] = [];
  const compressedGaps: CompressedGap[] = [];
  let realCursor = lo;
  let displayCursor = 0;

  const pushGap = (realStart: number, realEnd: number) => {
    const realDuration = realEnd - realStart;
    if (realDuration <= 0) return;
    const compressed = realDuration > GAP_COMPRESS_THRESHOLD_MS;
    const displayDuration = compressed ? COMPRESSED_GAP_DISPLAY_MS : realDuration;
    const segment: ScaleSegment = {
      kind: 'gap',
      realStart,
      realEnd,
      displayStart: displayCursor,
      displayEnd: displayCursor + displayDuration,
      compressed,
    };
    segments.push(segment);
    if (compressed) {
      compressedGaps.push({
        realStart,
        realEnd,
        realDuration,
        displayStart: segment.displayStart,
        displayEnd: segment.displayEnd,
      });
    }
    displayCursor += displayDuration;
  };

  for (const span of occupied) {
    pushGap(realCursor, span.start);
    segments.push({
      kind: 'occupied',
      realStart: span.start,
      realEnd: span.end,
      displayStart: displayCursor,
      displayEnd: displayCursor + (span.end - span.start),
      compressed: false,
    });
    displayCursor += span.end - span.start;
    realCursor = span.end;
  }
  pushGap(realCursor, hi);

  return finishScale('compact', segments, compressedGaps);
}
