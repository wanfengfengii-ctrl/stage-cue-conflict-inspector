import { useEffect, useMemo, useState } from 'react';
import { detectConflicts, parseAndValidate, conflictKey } from './core/conflicts';
import type { Conflict } from './core/types';
import type { TimelineMode } from './core/compactScale';
import { createFocusWindow, intersectsRange } from './core/focusWindow';
import type { FocusWindow } from './core/focusWindow';
import { formatMs } from './core/format';
import { InputPanel } from './components/InputPanel';
import { ConflictList } from './components/ConflictList';
import { Timeline } from './components/Timeline';
import { SAMPLE_CONFLICT, SAMPLE_TOUCHING } from './samples';
import './styles.css';

export default function App() {
  const [text, setText] = useState('');
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  // App 只保存“整日 / 紧凑”两种显示模式；映射纯派生，不改写任何真实时刻
  const [mode, setMode] = useState<TimelineMode>('day');
  // 聚焦上下文：以某次争用为锚（存它的稳定选择身份），窗口纯派生；
  // null = 回到完整演出。冲突列表始终消费原有 Conflict 对象，不做任何裁切。
  const [focusKey, setFocusKey] = useState<string | null>(null);
  // 选择在聚焦窗口内失效时的就近反馈（如下文选中窗口外的争用）
  const [notice, setNotice] = useState<string | null>(null);
  // 时刻游标：只有“未设置（null）/ 已设置绝对毫秒”这一组状态；
  // 标线坐标与占用清单全部由此派生，切换显示模式不改写它。
  const [cursorMs, setCursorMs] = useState<number | null>(null);

  // 结果完全由当前文本派生：非法输入时 result.ok === false，
  // 下游时间轴/冲突列表不会拿到任何旧结果（不存在沿用旧结果的路径）。
  const result = useMemo(() => parseAndValidate(text), [text]);

  const items = result.ok ? result.items : [];
  const conflicts: Conflict[] = useMemo(
    () => (result.ok ? detectConflicts(result.items) : []),
    [result],
  );

  const selectedConflict = useMemo(
    () => (selectedKey ? conflicts.find((c) => conflictKey(c) === selectedKey) ?? null : null),
    [conflicts, selectedKey],
  );
  const focusConflict = useMemo(
    () => (focusKey ? conflicts.find((c) => conflictKey(c) === focusKey) ?? null : null),
    [conflicts, focusKey],
  );
  // 窗口由领域层确定：锚冲突交集两侧各扩三十秒，并夹到当天范围
  const focusWindow: FocusWindow | null = focusConflict ? createFocusWindow(focusConflict) : null;

  // 编辑 / 粘贴 / 载入示例统一入口：只要“载入/修改动作”发生，就清除选择与聚焦、
  // 恢复整日模式、撤下时刻游标。不能只依赖 useEffect([text])——再次载入与当前
  // 完全相同的示例时 text 字符串不变、effect 不会运行，聚焦与紧凑状态会错误残留。
  const resetViewState = () => {
    setSelectedKey(null);
    setFocusKey(null);
    setMode('day');
    setNotice(null);
    setCursorMs(null);
  };

  const handleTextChange = (next: string) => {
    resetViewState();
    setText(next);
  };

  // 若选中（或聚焦锚点）的冲突在结果中消失，同样清除
  useEffect(() => {
    if (selectedKey && !conflicts.some((c) => conflictKey(c) === selectedKey)) {
      setSelectedKey(null);
    }
    if (focusKey && !conflicts.some((c) => conflictKey(c) === focusKey)) {
      setFocusKey(null);
    }
  }, [conflicts, selectedKey, focusKey]);

  const loadSample = (which: 'conflict' | 'touching') => {
    // 即使载入的示例与当前文本完全相同，也走重置（见 resetViewState 说明）
    resetViewState();
    setText(which === 'conflict' ? SAMPLE_CONFLICT : SAMPLE_TOUCHING);
  };

  // 仅切换显示模式：不重新校验、不改写数据，也不改变聚焦窗口与选中项，
  // 时间轴只重算坐标。
  const toggleMode = () => setMode((m) => (m === 'day' ? 'compact' : 'day'));

  // 从已选中的争用进入“聚焦上下文”。
  // 时刻游标若落在窗口外（半开 [startMs, endMs)）：就近反馈并清除游标——
  // 窗口内无法呈现该时刻，保留只会留下指向窗外的标线；落在窗口内则原样保留。
  const enterFocus = () => {
    if (!selectedConflict) return;
    const nextWindow = createFocusWindow(selectedConflict);
    if (cursorMs !== null && (cursorMs < nextWindow.startMs || cursorMs >= nextWindow.endMs)) {
      setCursorMs(null);
      setNotice(
        `游标已移出当前窗口：时刻 ${formatMs(cursorMs)} 不在聚焦窗口 [${formatMs(nextWindow.startMs)} → ${formatMs(nextWindow.endMs)}) 内，已清除游标。`,
      );
    } else {
      setNotice(null);
    }
    setFocusKey(conflictKey(selectedConflict));
  };

  // 退出聚焦：回到完整演出继续核对，选中项原样保留
  const exitFocus = () => {
    setFocusKey(null);
    setNotice(null);
  };

  // 列表 / 时间轴统一选择入口。聚焦期间若选中窗口【外】的争用（半开不相交），
  // 该选择在当前窗口内失效：就近反馈并退出聚焦，随后在完整演出中定位该争用。
  const handleSelect = (key: string | null) => {
    if (key === null) {
      setSelectedKey(null);
      setNotice(null);
      return;
    }
    const target = conflicts.find((c) => conflictKey(c) === key);
    if (!target) return;
    if (
      focusWindow &&
      !intersectsRange(target.overlapStart, target.overlapEnd, focusWindow.startMs, focusWindow.endMs)
    ) {
      setNotice(
        `争用 ${target.idA} ⨯ ${target.idB} 不在当前聚焦窗口内，已退出聚焦并回到完整演出定位。`,
      );
      setFocusKey(null);
      setSelectedKey(key);
      return;
    }
    setSelectedKey(key);
    setNotice(null);
  };

  // 刻度带点击统一入口：落点已由时间轴反演为绝对毫秒。
  // 聚焦窗口是半开区间 [startMs, endMs)：刻度带右缘点击经窗口映射反演会得到
  // 不属于窗口的终点 endMs（标线落到窗口外缘、详情也指向窗外时刻），因此夹回
  // 窗口内最后一毫秒，游标与聚焦状态始终同步；整日模式不夹取（日界此刻本无占用）。
  // 同时撤下旧提示——窗外清除的“已移出窗口”反馈不能与新的有效游标同时出现。
  const handleCursorChange = (momentMs: number) => {
    const next = focusWindow
      ? Math.max(focusWindow.startMs, Math.min(focusWindow.endMs - 1, momentMs))
      : momentMs;
    setCursorMs(next);
    setNotice(null);
  };

  // 从详情区手动清除游标：标线、详情与任何旧的移出窗口提示一并同步撤下。
  const handleCursorClear = () => {
    setCursorMs(null);
    setNotice(null);
  };

  const resourceCount = new Set(items.map((i) => i.resource)).size;

  return (
    <div className="app">
      <header className="app-header">
        <h1>舞台设备资源冲突检视器</h1>
        <p>
          灯光 · 升降台 · 雾机提示合并预检。区间一律按半开 <code>[startMs, endMs)</code> 判定，
          仅同一 <code>resource</code> 且交集长度 <strong>大于 0</strong> 才构成冲突——贴边交接不会被误报。
        </p>
      </header>

      <main className="layout">
        <InputPanel text={text} onTextChange={handleTextChange} issues={result.ok ? [] : result.issues} onLoadSample={loadSample} />

        <section className="panel result-panel" aria-label="检测结果">
          {text.trim().length === 0 ? (
            <div className="status status-idle" role="status" data-testid="status">
              等待输入：在左侧粘贴 JSON 数组后立即检测。
            </div>
          ) : !result.ok ? (
            <div className="status status-rejected" role="alert" data-testid="status">
              输入未通过校验，本批已整批拒绝，不显示任何时间轴或旧冲突结果。
            </div>
          ) : (
            <>
              {conflicts.length === 0 ? (
                <div className="status status-ok" role="status" data-testid="status">
                  ✓ 可执行：{items.length} 条提示 / {resourceCount} 项资源，未发现冲突。
                </div>
              ) : (
                <div className="status status-conflict" role="alert" data-testid="status">
                  ⚠ {items.length} 条提示 / {resourceCount} 项资源，发现 {conflicts.length} 处设备争用。
                  点击冲突卡片或时间轴上的红色交集，双方提示与交集将同步高亮。
                </div>
              )}

              <div className="timeline-toolbar">
                <button
                  type="button"
                  className={`mode-toggle${mode === 'compact' ? ' active' : ''}`}
                  onClick={toggleMode}
                  aria-pressed={mode === 'compact'}
                  data-testid="mode-toggle"
                  title={
                    mode === 'compact'
                      ? '恢复整日等比例时间轴（当前争用选择保留）'
                      : '把相邻提示之间超过五分钟的空档压成固定三十秒显示宽，真实时刻不变'
                  }
                >
                  {mode === 'compact' ? '返回整日时间轴' : '紧凑时间轴（压缩 >5 分钟空档）'}
                </button>
                {mode === 'compact' && !focusWindow && (
                  <span className="mode-hint" data-testid="mode-hint">
                    紧凑模式仅压缩显示：超过五分钟的空档固定为三十秒宽（断轴处标注真实起止），
                    提示与冲突的真实时刻、排序与判定均不变。
                  </span>
                )}

                {/* 聚焦上下文：仅当存在已选中的争用、且当前未聚焦时可用 */}
                {selectedConflict && !focusWindow && (
                  <button
                    type="button"
                    className="focus-toggle"
                    onClick={enterFocus}
                    data-testid="focus-button"
                    title="以该争用交集为锚，时间轴向前后各扩展三十秒并夹到当天范围"
                  >
                    聚焦上下文（前后各 30 秒）
                  </button>
                )}

                {focusWindow && focusConflict && (
                  <span className="focus-banner" data-testid="focus-banner">
                    <span className="focus-banner-text">
                      已聚焦：{focusConflict.idA} ⨯ {focusConflict.idB}，窗口 [{formatMs(focusWindow.startMs)} →{' '}
                      {formatMs(focusWindow.endMs)})，仅显示与之相交的提示与争用；标签与绝对时刻不变。
                    </span>
                    <button
                      type="button"
                      className="focus-exit"
                      onClick={exitFocus}
                      data-testid="exit-focus"
                    >
                      退出聚焦
                    </button>
                  </span>
                )}
              </div>

              {notice && (
                <div className="focus-notice" role="status" data-testid="focus-notice">
                  {notice}
                </div>
              )}

              <Timeline
                items={items}
                conflicts={conflicts}
                mode={mode}
                selectedKey={selectedKey}
                onSelect={handleSelect}
                window={focusWindow}
                cursorMs={cursorMs}
                onCursorChange={handleCursorChange}
                onCursorClear={handleCursorClear}
              />
              <ConflictList conflicts={conflicts} selectedKey={selectedKey} onSelect={handleSelect} />
            </>
          )}
        </section>
      </main>
    </div>
  );
}
