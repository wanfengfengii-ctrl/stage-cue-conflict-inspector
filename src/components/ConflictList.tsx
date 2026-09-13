import type { Conflict } from '../core/types';
import { conflictKey } from '../core/conflicts';
import { formatDuration, formatMs } from '../core/format';

interface ConflictListProps {
  conflicts: Conflict[];
  selectedKey: string | null;
  onSelect: (key: string | null) => void;
  /** 当前资源范围（null = 全部资源）；conflicts 已是该范围的投影。 */
  scope: string | null;
}

/** 右下：冲突明细列表，点击后与时间轴联动高亮。 */
export function ConflictList({ conflicts, selectedKey, onSelect, scope }: ConflictListProps) {
  if (conflicts.length === 0) {
    // 隔离视图下的局部空结果：必须明确“该资源无争用”，
    // 不能沿用全场视图的“可执行”结论——其它资源未在此列出。
    if (scope !== null) {
      return (
        <div className="scope-empty" role="status" data-testid="scope-empty">
          <strong>资源「{scope}」无争用。</strong>
          <p>
            该资源的提示在半开 [startMs, endMs) 判定下互不重叠。这只是当前资源范围的局部结论，
            其余资源的争用未在此列出——请通过“显示全部资源”回到全场视图核对整批。
          </p>
        </div>
      );
    }
    return (
      <div className="all-clear" role="status" data-testid="all-clear">
        <strong>✓ 可执行：未发现设备资源冲突。</strong>
        <p>
          所有提示在各自设备上互不重叠。区间按半开 [startMs, endMs) 判定，
          一条提示的结束时刻恰好等于另一条的开始时刻（贴边交接）不会被误报。
        </p>
      </div>
    );
  }

  return (
    <div className="conflict-list" aria-label="冲突列表">
      <h3>
        {scope === null
          ? `发现 ${conflicts.length} 处设备争用（每对仅列一次，按 resource / 重叠起点 / id 码点序排列）`
          : `资源「${scope}」的 ${conflicts.length} 处争用（与全场视图同一排序与选择身份）`}
      </h3>
      <ol>
        {conflicts.map((c) => {
          const key = conflictKey(c);
          const active = key === selectedKey;
          return (
            <li key={key}>
              <button
                type="button"
                className={`conflict-card${active ? ' active' : ''}`}
                onClick={() => onSelect(active ? null : key)}
                aria-pressed={active}
                data-testid="conflict-card"
              >
                <span className="conflict-resource" data-testid="conflict-resource">
                  {c.resource}
                </span>
                <span className="conflict-ids">
                  <code>{c.idA}</code>
                  {' ⨯ '}
                  <code>{c.idB}</code>
                </span>
                <span className="conflict-time">
                  重叠 [{formatMs(c.overlapStart)} → {formatMs(c.overlapEnd)})
                </span>
                <span className="conflict-duration">时长 {formatDuration(c.overlapDuration)}</span>
              </button>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
