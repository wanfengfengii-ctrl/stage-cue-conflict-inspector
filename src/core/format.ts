import { MS_PER_DAY } from './types';

/** 将毫秒格式化为 mm:ss.mmm（以演出零点计），供时间轴与冲突详情使用。 */
export function formatMs(ms: number): string {
  const clamped = Math.max(0, Math.min(MS_PER_DAY, Math.round(ms)));
  const minutes = Math.floor(clamped / 60_000);
  const seconds = Math.floor((clamped % 60_000) / 1_000);
  const millis = clamped % 1_000;
  const pad = (n: number, width = 2) => String(n).padStart(width, '0');
  return `${pad(minutes)}:${pad(seconds)}.${pad(millis, 3)}`;
}

/** 时长统一以毫秒显示：冲突定位要求逐毫秒精确，不做会损失精度的换算。 */
export function formatDuration(ms: number): string {
  return `${ms}ms`;
}
