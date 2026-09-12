import { useEffect, useMemo, useState } from 'react';
import { detectConflicts, parseAndValidate } from './core/conflicts';
import type { Conflict } from './core/types';
import { InputPanel } from './components/InputPanel';
import { ConflictList, conflictKey } from './components/ConflictList';
import { Timeline } from './components/Timeline';
import { SAMPLE_CONFLICT, SAMPLE_TOUCHING } from './samples';
import './styles.css';

export default function App() {
  const [text, setText] = useState('');
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  // 结果完全由当前文本派生：非法输入时 result.ok === false，
  // 下游时间轴/冲突列表不会拿到任何旧结果（不存在沿用旧结果的路径）。
  const result = useMemo(() => parseAndValidate(text), [text]);

  const items = result.ok ? result.items : [];
  const conflicts: Conflict[] = useMemo(
    () => (result.ok ? detectConflicts(result.items) : []),
    [result],
  );

  // 文本一旦变化（重新解析）即清除选中态，避免高亮指向已不存在的冲突
  useEffect(() => {
    setSelectedKey(null);
  }, [text]);

  // 若选中的冲突在新结果中消失，同样清除
  useEffect(() => {
    if (selectedKey && !conflicts.some((c) => conflictKey(c) === selectedKey)) {
      setSelectedKey(null);
    }
  }, [conflicts, selectedKey]);

  const loadSample = (which: 'conflict' | 'touching') => {
    setText(which === 'conflict' ? SAMPLE_CONFLICT : SAMPLE_TOUCHING);
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
        <InputPanel text={text} onTextChange={setText} issues={result.ok ? [] : result.issues} onLoadSample={loadSample} />

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

              <Timeline
                items={items}
                conflicts={conflicts}
                selectedKey={selectedKey}
                onSelect={setSelectedKey}
              />
              <ConflictList conflicts={conflicts} selectedKey={selectedKey} onSelect={setSelectedKey} />
            </>
          )}
        </section>
      </main>
    </div>
  );
}
