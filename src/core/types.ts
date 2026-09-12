/**
 * 舞台设备资源提示的数据模型。
 *
 * 区间统一采用半开区间 [startMs, endMs)：
 * 一项在 startMs 时刻开始占用资源，在 endMs 时刻释放；
 * 因此一个区间的 endMs 等于另一个区间的 startMs 时（贴边提示）不构成冲突。
 */

/** 一天的毫秒数，也是时间字段允许的最大值。 */
export const MS_PER_DAY = 86_400_000;

/** 一条已通过校验的资源占用提示。 */
export interface CueItem {
  /** 同一批输入内唯一的非空字符串标识。 */
  id: string;
  /** 被占用的设备资源（非空字符串），例如 "灯光-面光L1"。 */
  resource: string;
  /** 占用起点（含），单位毫秒，0 ≤ startMs < endMs ≤ 86400000。 */
  startMs: number;
  /** 占用终点（不含），单位毫秒。 */
  endMs: number;
}

/** 原始 JSON 解析后未校验的单条结构。 */
export type RawItem = unknown;

/** 定位到某一条目（或输入整体）的校验问题。 */
export interface ValidationIssue {
  /** 问题所在条目在输入数组中的下标；顶层问题（非数组/空数组）使用 -1。 */
  index: number;
  /** 面向舞台监督的可读原因。 */
  message: string;
}

/** 校验失败结果：整批拒绝，且不产生任何冲突结果。 */
export interface ValidationFailure {
  ok: false;
  issues: ValidationIssue[];
}

/** 校验成功结果。 */
export interface ValidationSuccess {
  ok: true;
  items: CueItem[];
}

export type ValidationResult = ValidationFailure | ValidationSuccess;

/** 一对资源争用：两条提示在同一设备上的时间交集长度严格大于零。 */
export interface Conflict {
  resource: string;
  /** Unicode 码点顺序较小的 id。 */
  idA: string;
  /** Unicode 码点顺序较大的 id。 */
  idB: string;
  /** 重叠区间起点（含），毫秒。 */
  overlapStart: number;
  /** 重叠区间终点（不含），毫秒。 */
  overlapEnd: number;
  /** 重叠时长，毫秒；恒等于 overlapEnd - overlapStart 且严格大于零。 */
  overlapDuration: number;
}
