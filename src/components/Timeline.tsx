import { useMemo } from 'react';
import type { Conflict, CueItem } from '../core/types';
import { compareByCodePoint, conflictKey } from '../core/conflicts';
import { createTimeScale } from '../core/compactScale';
import type { TimelineMode, TimeScale } from '../core/compactScale';
import { intersectsRange } from '../core/focusWindow';
import type { FocusWindow } from '../core/focusWindow';
import { pickOverlap } from '../core/overlapHit';
import type { OverlapHit } from '../core/overlapHit';
import { formatDuration, formatMs } from '../core/format';

interface TimelineProps {
  items: CueItem[];
  conflicts: Conflict[];
  mode: TimelineMode;
  selectedKey: string | null;
  onSelect: (key: string | null) => void;
  /** 聚焦窗口（半开）：给定后时间轴只呈现与其相交的提示与冲突；null 表示整日演出。 */
  window: FocusWindow | null;
}

interface ResourceRow {
  resource: string;
  items: CueItem[];
}

const ROW_HEIGHT = 56;
const RULER_HEIGHT_DAY = 28;
const RULER_HEIGHT_COMPACT = 44;
/** 显示轴上每 30_000 显示毫秒一道刻度（整日即真实 30 秒；紧凑模式刻度坐标同样取自映射）。 */
const TICK_DISPLAY_MS = 30_000;

/**
 * 交集按钮的点击不在元素自身判定归属：浏览器只把叠放区的点击交给最上层按钮，
 * 这里读取同一资源轨道内全部交集的真实/热区几何，交给纯函数 pickOverlap
 * 按点击坐标解析——完全重叠的多组争用可逐组轮换，扩展热区互相覆盖时
 * 归属到用户实际指向的那一组。
 */
function resolveOverlapClick(
  button: HTMLButtonElement,
  clientX: number,
  opts: { selectedKey: string | null; fallbackKey: string; onSelect: (key: string | null) => void },
) {
  const track = button.closest('.tl-track');
  if (!track) {
    opts.onSelect(opts.fallbackKey === opts.selectedKey ? null : opts.fallbackKey);
    return;
  }

  const trackRect = track.getBoundingClientRect();
  const hits: OverlapHit[] = [];
  track.querySelectorAll<HTMLButtonElement>('button.overlap').forEach((btn) => {
    const key = btn.dataset.overlapKey;
    const widthFraction = Number(btn.dataset.realWidthFraction);
    if (!key || !Number.isFinite(widthFraction)) return;
    const rect = btn.getBoundingClientRect();
    // 最小热区只向右扩、不改变左缘，因此热区左缘就是真实交集左缘；
    // rect.width 已包含紧凑轴的最小热区宽度，真实宽度由映射比例精确给出。
    const left = rect.left - trackRect.left;
    hits.push({
      key,
      realLeft: left,
      realWidth: widthFraction * trackRect.width,
      hotLeft: left,
      hotWidth: rect.width,
    });
  });

  const resolved = pickOverlap(hits, clientX - trackRect.left, opts.selectedKey);
  if (resolved === undefined) {
    opts.onSelect(opts.fallbackKey === opts.selectedKey ? null : opts.fallbackKey);
    return;
  }
  opts.onSelect(resolved);
}

/**
 * 按资源绘制的可滚动时间轴。
 * 所有横向坐标（提示块、冲突交集、刻度、点击区域、断轴标记）统一取自 TimeScale：
 * 整日模式等比例映射全天，紧凑模式把超过五分钟的空档压成固定三十秒显示宽。
 * 选择某条冲突时：双方提示块与交集区域同步高亮（列表与时间轴共用 selectedKey）。
 */
export function Timeline({ items, conflicts, mode, selectedKey, onSelect, window: focusWindow }: TimelineProps) {
  // 映射只由“模式 + 当前合法结果 + 聚焦窗口”派生，永不改写提示本身。
  // 聚焦窗口只把映射的覆盖区间收窄到 [window.startMs, window.endMs)，
  // 窗口内整日等比例 / 紧凑压缩规则不变；切模式只重算坐标。
  const scale = useMemo(
    () => createTimeScale(mode, items, focusWindow ?? undefined),
    [mode, items, focusWindow],
  );

  // 窗口内只呈现【与其半开相交】的提示：恰好贴边（end === 窗口起点等）不算。
  // 不过滤原数组、不改写任何字段；跨边界图形的几何由窗口映射自然裁短，
  // 标签（id）与绝对毫秒值保持原样。null 窗口 = 整日演出，全部呈现。
  const visibleItems = useMemo(
    () =>
      focusWindow
        ? items.filter((it) => intersectsRange(it.startMs, it.endMs, focusWindow.startMs, focusWindow.endMs))
        : items,
    [items, focusWindow],
  );

  // 窗口内的冲突同样按交集的半开相交过滤（锚点冲突必与其窗口相交）；
  // 冲突列表仍消费原有 Conflict 对象，这里只决定时间轴上画哪些交集。
  const visibleConflicts = useMemo(
    () =>
      focusWindow
        ? conflicts.filter((c) =>
            intersectsRange(c.overlapStart, c.overlapEnd, focusWindow.startMs, focusWindow.endMs),
          )
        : conflicts,
    [conflicts, focusWindow],
  );

  const rows = useMemo<ResourceRow[]>(() => {
    const map = new Map<string, CueItem[]>();
    for (const item of visibleItems) {
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
  }, [visibleItems]);

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
  // 所有横向坐标都是相对整条轨道的百分比：
  // 映射只规定【相对比例】（占用与短空档等比、长空档固定三十秒显示宽），
  // 轨道在视图内弹性铺宽，整体再等比缩放——紧凑后无需横向滚动数十屏。
  // 1ms 交集在 CSS 上另有最小点击热区（见 styles.css），保证逐毫秒可点。

  return (
    <div className="timeline-scroll" data-testid="timeline-scroll" tabIndex={0}>
      <div className="timeline-inner" data-testid="timeline-inner" data-mode={mode}>
        <div className="timeline-ruler" style={{ height: rulerHeight }}>
          <div className="tl-label ruler-label" aria-hidden="true" />
          <div className="ruler-canvas">
            {ticks.map((t) => {
              const isEnd = t.display === scale.totalDisplay;
              return (
                <div
                  key={t.display}
                  className={`tick${isEnd ? ' tick-end' : ''}`}
                  style={{ left: `${(t.display / scale.totalDisplay) * 100}%` }}
                >
                  <span className="tick-label">{formatMs(t.real)}</span>
                </div>
              );
            })}
            <AxisMarkers scale={scale} withLabels />
          </div>
        </div>

        {rows.map((row) => {
          const placed = lanes.get(row.resource)!;
          const maxLane = Math.max(0, ...placed.map((p) => p.lane));
          const rowConflicts = visibleConflicts.filter((c) => c.resource === row.resource);
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
              <div className="tl-track">
                <AxisMarkers scale={scale} />

                {/* 交集区域（点击区域，坐标取自映射；紧凑模式下 1ms 争用仍宽 1px）。
                    多个标记可能叠在同一点、或扩展热区互相覆盖，因此点击不在元素自身
                    判定归属，而由 resolveOverlapClick 按点击坐标在本行全部热区中解析。 */}
                {rowConflicts.map((c) => {
                  const key = conflictKey(c);
                  const realLeftFraction = scale.fraction(c.overlapStart);
                  const realWidthFraction = scale.fractionSpan(c.overlapStart, c.overlapEnd);
                  return (
                    <button
                      type="button"
                      key={`ov-${key}`}
                      className={`overlap${key === selectedKey ? ' active' : ''}`}
                      style={{
                        left: `${realLeftFraction * 100}%`,
                        width: `${realWidthFraction * 100}%`,
                        top: 4,
                        height: 18,
                      }}
                      title={`${c.idA} ⨯ ${c.idB}，重叠 ${c.overlapDuration}ms`}
                      aria-label={`冲突：${c.idA} 与 ${c.idB}，重叠 ${c.overlapDuration} 毫秒`}
                      onClick={(event) =>
                        resolveOverlapClick(event.currentTarget, event.clientX, {
                          selectedKey,
                          fallbackKey: key,
                          onSelect,
                        })
                      }
                      data-testid="overlap"
                      data-overlap-key={key}
                      data-real-width-fraction={realWidthFraction}
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
