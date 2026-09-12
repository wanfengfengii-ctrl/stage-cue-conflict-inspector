import { describe, expect, it } from 'vitest';
import { findArrayElementSpans } from './jsonPositions';

describe('findArrayElementSpans', () => {
  it('定位多个对象元素的行列', () => {
    const text = `[
  { "id": "a", "resource": "r", "startMs": 0, "endMs": 1 },
  { "id": "b", "resource": "r", "startMs": 2, "endMs": 3 }
]`;
    const spans = findArrayElementSpans(text);
    expect(spans).toHaveLength(2);
    expect(spans[0]!.startLine).toBe(2);
    expect(spans[1]!.startLine).toBe(3);
    expect(text.slice(spans[0]!.start, spans[0]!.end).startsWith('{')).toBe(true);
    expect(text.slice(spans[1]!.start, spans[1]!.end).endsWith('}')).toBe(true);
  });

  it('字符串中的括号与逗号不影响扫描', () => {
    const text = '[{"id":"a,b]","x":[1,2]},{"id":"\\"b","resource":"r"}]';
    const spans = findArrayElementSpans(text);
    expect(spans).toHaveLength(2);
  });

  it('压缩成一行时也能定位', () => {
    const spans = findArrayElementSpans('[{"id":"a"},{"id":"b"}]');
    expect(spans).toHaveLength(2);
    expect(spans[0]!.startColumn).toBe(2);
  });

  it('找不到数组时返回空', () => {
    expect(findArrayElementSpans('{"id":"a"}')).toEqual([]);
  });
});
