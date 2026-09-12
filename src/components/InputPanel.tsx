import { useMemo, useRef } from 'react';
import type { ValidationIssue } from '../core/types';
import { findArrayElementSpans } from '../core/jsonPositions';

interface InputPanelProps {
  text: string;
  onTextChange: (text: string) => void;
  issues: ValidationIssue[];
  onLoadSample: (which: 'conflict' | 'touching') => void;
}

/** 左侧：JSON 粘贴区与就近错误反馈。 */
export function InputPanel({ text, onTextChange, issues, onLoadSample }: InputPanelProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // 下标 -> 原始文本中的行列/区间，用于“在对应条目附近”定位
  const spans = useMemo(() => findArrayElementSpans(text), [text]);

  const selectEntry = (index: number) => {
    const ta = textareaRef.current;
    if (!ta) return;
    const span = spans[index];
    ta.focus();
    if (span) {
      ta.setSelectionRange(span.start, span.end);
      const lines = text.slice(0, span.start).split('\n');
      const lineHeight = 20;
      ta.scrollTop = Math.max(0, (lines.length - 1) * lineHeight - ta.clientHeight / 2);
    }
  };

  const issuesByIndex = useMemo(() => {
    const map = new Map<number, ValidationIssue[]>();
    for (const issue of issues) {
      const list = map.get(issue.index);
      if (list) list.push(issue);
      else map.set(issue.index, [issue]);
    }
    return map;
  }, [issues]);

  const topIssues = issuesByIndex.get(-1) ?? [];
  const entryIssues = [...issuesByIndex.entries()]
    .filter(([index]) => index >= 0)
    .sort((a, b) => a[0] - b[0]);

  return (
    <section className="panel input-panel" aria-label="提示输入">
      <div className="panel-head">
        <h2>粘贴提示 JSON 数组</h2>
        <div className="sample-buttons">
          <button type="button" onClick={() => onLoadSample('conflict')}>
            载入示例（含冲突）
          </button>
          <button type="button" onClick={() => onLoadSample('touching')}>
            载入示例（贴边·安全）
          </button>        </div>
      </div>

      <textarea
        ref={textareaRef}
        className="json-input"
        spellCheck={false}
        value={text}
        onChange={(event) => onTextChange(event.target.value)}
        placeholder={'[\n  { "id": "LX-01", "resource": "灯光-面光L1", "startMs": 0, "endMs": 120000 }\n]'}
        aria-label="JSON 数组输入区"
      />

      {issues.length > 0 && (
        <div className="issues" role="alert" aria-label="校验问题">
          <h3>整批拒绝（{issues.length} 个问题）——已清空旧结果，修正后重新检测</h3>
          {topIssues.length > 0 && (
            <ul className="issue-group">
              {topIssues.map((issue, i) => (
                <li key={`t-${i}`} className="issue-item issue-top">
                  <span className="issue-badge">整体</span>
                  <span>{issue.message}</span>
                </li>
              ))}
            </ul>
          )}
          {entryIssues.map(([index, list]) => {
            const span = spans[index];
            return (
              <ul key={index} className="issue-group">
                {list.map((issue, i) => (
                  <li key={i} className="issue-item">
                    <button
                      type="button"
                      className="issue-jump"
                      onClick={() => selectEntry(index)}
                      title={span ? `点击选中第 ${index + 1} 条原文（第 ${span.startLine} 行）` : '点击聚焦输入框'}
                    >
                      <span className="issue-badge">
                        第 {index + 1} 条{span ? ` · 行 ${span.startLine}` : ''}
                      </span>
                    </button>
                    <span>{issue.message}</span>
                  </li>
                ))}
              </ul>
            );
          })}
        </div>
      )}
    </section>
  );
}
