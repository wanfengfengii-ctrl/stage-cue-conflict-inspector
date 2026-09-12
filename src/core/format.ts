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

/** 时长（毫秒）的人类可读表示：523ms / 01:02.003。 */
export function formatDuration(ms: number): string {
  if (ms < 60_000) return `${ms}ms`;
  return `${formatMs(ms)}（${ms}ms）`;
}
