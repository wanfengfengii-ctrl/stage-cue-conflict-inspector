import { useMemo } from 'react';
import type { Conflict, CueItem } from '../core/types';
import { MS_PER_DAY } from '../core/types';
import { compareByCodePoint } from '../core/conflicts';
import { formatMs } from '../core/format';
import { conflictKey } from './ConflictList';

interface TimelineProps {
  items: CueItem[];
  conflicts: Conflict[];
  selectedKey: string | null;
  onSelect: (key: string | null) => void;
}

interface ResourceRow {
  resource: string;
  items: CueItem[];
}

const ROW_HEIGHT = 56;
const RULER_HEIGHT = 28;

/**
 * 按资源绘制的可滚动时间轴。
 * 选择某条冲突时：双方提示块与交集区域同步高亮（列表与时间轴共用 selectedKey）。
 */
export function Timeline({ items, conflicts, selectedKey, onSelect }: TimelineProps) {
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

  // 刻度：每 30 秒一道主刻度
  const ticks: number[] = [];
  for (let t = 0; t <= MS_PER_DAY; t += 30_000) ticks.push(t);

  const pct = (ms: number) => `${(ms / MS_PER_DAY) * 100}%`;

  return (
    <div className="timeline-scroll" data-testid="timeline-scroll" tabIndex={0}>
      <div className="timeline-inner">
        <div className="timeline-ruler" style={{ height: RULER_HEIGHT }}>
          {ticks.map((t) => (
            <div key={t} className="tick" style={{ left: pct(t) }}>
              <span className="tick-label">{formatMs(t)}</span>
            </div>
          ))}
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
              <div className="tl-track">
                {/* 交集区域 */}
                {rowConflicts.map((c) => {
                  const key = conflictKey(c);
                  return (
                    <button
                      type="button"
                      key={`ov-${key}`}
                      className={`overlap${key === selectedKey ? ' active' : ''}`}
                      style={{
                        left: pct(c.overlapStart),
                        width: pct(c.overlapDuration),
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
                        left: pct(item.startMs),
                        width: pct(item.endMs - item.startMs),
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
