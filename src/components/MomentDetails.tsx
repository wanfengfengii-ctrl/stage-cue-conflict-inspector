import type { MomentOccupancy } from '../core/momentCursor';
import { formatMs } from '../core/format';

interface MomentDetailsProps {
  /** 游标指向的绝对毫秒（当天）。 */
  momentMs: number;
  /** 该时刻仍在占用设备的提示，按 resource 分组、组内 id 码点序（领域层派生）。 */
  occupancy: MomentOccupancy[];
  /** 清除游标：撤下标线与详情，继续核对冲突。 */
  onClear: () => void;
}

/**
 * 时刻详情区：呈现游标指向的真实时刻与该时刻各设备的实际占用者。
 * 无占用时明确显示“此刻无设备占用”（标线保留在时间轴上）；
 * 清单由 occupancyAtMoment 派生，本组件不做任何判定。
 */
export function MomentDetails({ momentMs, occupancy, onClear }: MomentDetailsProps) {
  const total = occupancy.reduce((n, group) => n + group.cues.length, 0);
  return (
    <div className="moment-details" data-testid="moment-details" aria-label="时刻详情">
      <div className="moment-details-head">
        <strong className="moment-label" data-testid="moment-label">
          时刻 {formatMs(momentMs)}
        </strong>
        {total === 0 ? (
          <span className="moment-summary" data-testid="moment-empty">
            此刻无设备占用
          </span>
        ) : (
          <span className="moment-summary">
            此刻 {occupancy.length} 项资源 / {total} 条提示占用中
          </span>
        )}
        <button
          type="button"
          className="cursor-clear"
          onClick={onClear}
          data-testid="cursor-clear"
          title="撤下时刻游标与详情，继续核对冲突"
        >
          清除游标
        </button>
      </div>
      {total > 0 && (
        <ul className="moment-groups">
          {occupancy.map((group) => (
            <li key={group.resource} className="moment-group" data-testid="moment-group">
              <span className="moment-resource" data-testid="moment-resource">
                {group.resource}
              </span>
              <span className="moment-cues">
                {group.cues.map((cue) => (
                  <code
                    key={cue.id}
                    title={`${cue.id} [${formatMs(cue.startMs)} → ${formatMs(cue.endMs)})`}
                  >
                    {cue.id}
                  </code>
                ))}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
