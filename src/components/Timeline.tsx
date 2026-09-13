import { useMemo } from 'react';
import type { Conflict, CueItem } from '../core/types';
import { compareByCodePoint } from '../core/conflicts';
import { createTimeScale } from '../core/compactScale';
import type { TimelineMode, TimeScale } from '../core/compactScale';
import { formatDuration, formatMs } from '../core/format';
import { conflictKey } from './ConflictList';

interface TimelineProps {
  items: CueItem[];
  conflicts: Conflict[];
  mode: TimelineMode;
  selectedKey: string | null;
  onSelect: (key: string | null) => void;
}

interface ResourceRow {
  resource: string;
  items: CueItem[];
}

const ROW_HEIGHT = 56;
const RULER_HEIGHT_DAY = 28;
const RULER_HEIGHT_COMPACT = 44;
const LABEL_WIDTH = 130;
/** 显示轴上每 30_000 显示毫秒一道刻度（整日即真实 30 秒；紧凑模式刻度坐标同样取自映射）。 */
const TICK_DISPLAY_MS = 30_000;

/**
 * 按资源绘制的可滚动时间轴。
 * 所有横向坐标（提示块、冲突交集、刻度、点击区域、断轴标记）统一取自 TimeScale：
 * 整日模式等比例映射全天，紧凑模式把超过五分钟的空档压成固定三十秒显示宽。
 * 选择某条冲突时：双方提示块与交集区域同步高亮（列表与时间轴共用 selectedKey）。
 */
export function Timeline({ items, conflicts, mode, selectedKey, onSelect }: TimelineProps) {
  // 映射只由“模式 + 当前合法结果”派生，永不改写提示本身
  const scale = useMemo(() => createTimeScale(mode, items), [mode, items]);

  const rows = useMemo<ResourceRow[]>(() => {
    const map = new Map<string, CueItem[]>();
    for (const item of items) {
      const list = map.get(item.resource);
      if (list) list.push(item);
      else map.set(item.resource, [item]);
    }
    return [...map.entries()]
      .map(([resource, list]) => ({
        resource,
        items: [...list].sort((a, b) => a.startMs - b.startMs || compareByCodePoint(a.id, b.id)),
      }))
      .sort((a, b) => compareByCodePoint(a.resource, b.resource));
  }, [items]);

  // 为每个资源内的提示块分配泳道，避免同资源多条提示重叠时块互相覆盖
  const lanes = useMemo(() => {
    const result = new Map<string, { item: CueItem; lane: number }[]>();
    for (const row of rows) {
      const placed: { item: CueItem; lane: number }[] = [];
      const laneEnds: number[] = [];
      for (const item of row.items) {
        // 半开区间：start >= 已有块的 end 即可复用泳道（贴边可同泳道）
        let lane = laneEnds.findIndex((end) => item.startMs >= end);
        if (lane === -1) {
          lane = laneEnds.length;
          laneEnds.push(item.endMs);
        } else {
          laneEnds[lane] = item.endMs;
        }
        placed.push({ item, lane });
      }
      result.set(row.resource, placed);
    }
    return result;
  }, [rows]);

  const selected = selectedKey ? conflicts.find((c) => conflictKey(c) === selectedKey) ?? null : null;
  const selectedIds = selected ? new Set([selected.idA, selected.idB]) : null;

  // 刻度沿【显示轴】等距采样，真实时刻由映射反演：整日即每 30 秒一刻度。
  // 紧凑模式下落在压缩空档内部的采样点一律剔除——空档已折断时间轴，
  // 其真实起止由断轴标记单独标注，避免在断轴内部画出误导性时刻。
  const ticks = useMemo(() => {
    const out: { display: number; real: number }[] = [];
    for (let d = 0; d < scale.totalDisplay; d += TICK_DISPLAY_MS) {
      const insideCompressed = scale.compressedGaps.some(
        (g) => d > g.displayStart && d < g.displayEnd,
      );
      if (!insideCompressed) out.push({ display: d, real: scale.toReal(d) });
    }
    const last = scale.totalDisplay;
    if (out.length === 0 || out[out.length - 1].display !== last) {
      out.push({ display: last, real: scale.toReal(last) });
    }
    return out;
  }, [scale]);

  const rulerHeight = mode === 'compact' ? RULER_HEIGHT_COMPACT : RULER_HEIGHT_DAY;
  // 紧凑模式以 1 显示毫秒 = 1px 定宽（含左侧资源标签），因此占用段内 1ms 的真实争用仍占 1px，
  // 可被逐毫秒点中；容器自身横向滚动。整日模式保持弹性最小宽度。
  const compactInnerWidth = mode === 'compact' ? LABEL_WIDTH + scale.totalDisplay : undefined;
  const trackStyle =
    mode === 'compact'
      ? ({ width: scale.totalDisplay, minWidth: 0, flex: '0 0 auto' } as const)
      : undefined;

  return (
    <div className="timeline-scroll" data-testid="timeline-scroll" tabIndex={0}>
      <div
        className="timeline-inner"
        data-testid="timeline-inner"
        data-mode={mode}
        style={
          compactInnerWidth !== undefined
            ? { width: compactInnerWidth, minWidth: compactInnerWidth }
            : undefined
        }
      >
        <div className="timeline-ruler" style={{ height: rulerHeight }}>
          <div className="tl-label ruler-label" aria-hidden="true" />
          <div className="ruler-canvas" style={trackStyle}>
            {ticks.map((t) => (
              <div
                key={t.display}
                className="tick"
                style={{ left: `${(t.display / scale.totalDisplay) * 100}%` }}
              >
                <span className="tick-label">{formatMs(t.real)}</span>
              </div>
            ))}
            <AxisMarkers scale={scale} withLabels />
          </div>
        </div>

        {rows.map((row) => {
          const placed = lanes.get(row.resource)!;
          const maxLane = Math.max(0, ...placed.map((p) => p.lane));
          const rowConflicts = conflicts.filter((c) => c.resource === row.resource);
          const hasActive = rowConflicts.some((c) => conflictKey(c) === selectedKey);

          return (
            <div
              key={row.resource}
              className={`tl-row${hasActive ? ' tl-row-active' : ''}`}
              style={{ height: ROW_HEIGHT + maxLane * 14 }}
            >
              <div className="tl-label" title={row.resource}>
                {row.resource}
              </div>
              <div className="tl-track" style={trackStyle}>
                <AxisMarkers scale={scale} />

                {/* 交集区域（点击区域，坐标取自映射；紧凑模式下 1ms 争用仍宽 1px） */}
                {rowConflicts.map((c) => {
                  const key = conflictKey(c);
                  return (
                    <button
                      type="button"
                      key={`ov-${key}`}
                      className={`overlap${key === selectedKey ? ' active' : ''}`}
                      style={{
                        left: `${scale.fraction(c.overlapStart) * 100}%`,
                        width: `${scale.fractionSpan(c.overlapStart, c.overlapEnd) * 100}%`,
                        top: 4,
                        height: 18,
                      }}
                      title={`${c.idA} ⨯ ${c.idB}，重叠 ${c.overlapDuration}ms`}
                      aria-label={`冲突：${c.idA} 与 ${c.idB}，重叠 ${c.overlapDuration} 毫秒`}
                      onClick={() => onSelect(key === selectedKey ? null : key)}
                      data-testid="overlap"
                    />
                  );
                })}

                {/* 提示块 */}
                {placed.map(({ item, lane }) => {
                  const dimmed = selectedIds !== null && !selectedIds.has(item.id);
                  const hot = selectedIds?.has(item.id) ?? false;
                  return (
                    <div
                      key={item.id}
                      className={`cue-block${hot ? ' hot' : ''}${dimmed ? ' dimmed' : ''}`}
                      style={{
                        left: `${scale.fraction(item.startMs) * 100}%`,
                        width: `${scale.fractionSpan(item.startMs, item.endMs) * 100}%`,
                        top: 26 + lane * 14,
                      }}
                      title={`${item.id} [${formatMs(item.startMs)} → ${formatMs(item.endMs)})`}
                    >
                      <span className="cue-block-id">{item.id}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * 压缩空档处的断轴标记：双斜杆贯穿整行，并在刻度带上标注该空档的真实起止。
 * 纯展示层：pointer-events 关闭，不参与任何点击判定。
 */
function AxisMarkers({ scale, withLabels = false }: { scale: TimeScale; withLabels?: boolean }) {
  if (scale.compressedGaps.length === 0) return null;
  return (
    <>
      {scale.compressedGaps.map((gap, i) => {
        const left = (scale.toDisplay(gap.realStart) / scale.totalDisplay) * 100;
        const width =
          ((scale.toDisplay(gap.realEnd) - scale.toDisplay(gap.realStart)) / scale.totalDisplay) * 100;
        const label = `断轴：空档 ${formatMs(gap.realStart)} 至 ${formatMs(gap.realEnd)}，真实时长 ${formatDuration(
          gap.realDuration,
        )}，压缩为 30 秒显示宽，真实时刻不变`;
        return (
          <div
            key={`${gap.realStart}-${i}`}
            className="axis-break"
            data-testid="axis-break"
            data-real-start={gap.realStart}
            data-real-end={gap.realEnd}
            role="img"
            aria-label={label}
            title={label}
            style={{ left: `${left}%`, width: `${width}%` }}
          >
            <span className="axis-break-slash" aria-hidden="true" />
            {withLabels && (
              <span className="axis-break-label" aria-hidden="true">
                <span className="axis-break-line">起 {formatMs(gap.realStart)}</span>
                <span className="axis-break-line">止 {formatMs(gap.realEnd)}</span>
              </span>
            )}
          </div>
        );
      })}
    </>
  );
}
