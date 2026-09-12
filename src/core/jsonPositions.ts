/**
 * 在原始 JSON 文本中定位顶层数组各元素的字符区间。
 *
 * 校验失败时需要“在对应条目附近反馈原因”：错误里只有数组下标，
 * 这里通过括号扫描（感知字符串与转义）找到第 N 个元素的起止偏移
 * 以及行列号，UI 可据此把光标选中到对应条目。
 *
 * 对语法不完整的输入采用尽力而为策略：找不到时返回空数组。
 */
export interface TextSpan {
  /** 元素起始字符偏移（含） */
  start: number;
  /** 元素结束字符偏移（不含） */
  end: number;
  /** 1 起始的行号 */
  startLine: number;
  startColumn: number;
}

export function findArrayElementSpans(text: string): TextSpan[] {
  const spans: TextSpan[] = [];
  const openBracket = text.indexOf('[');
  if (openBracket === -1) return spans;

  let depth = 0;
  let inString = false;
  let escaped = false;
  let elementStart = -1;

  const lineAndColumn = (offset: number): { line: number; column: number } => {
    let line = 1;
    let lastNewline = -1;
    for (let i = 0; i < offset; i++) {
      if (text[i] === '\n') {
        line++;
        lastNewline = i;
      }
    }
    return { line, column: offset - lastNewline };
  };

  const trimEnds = (s: number, e: number): [number, number] => {
    let start = s;
    let end = e;
    while (start < end && /\s/.test(text[start]!)) start++;
    while (end > start && /\s/.test(text[end - 1]!)) end--;
    return [start, end];
  };

  const pushSpan = (end: number) => {
    if (elementStart === -1) return;
    const [s, e] = trimEnds(elementStart, end);
    if (s < e) {
      const { line, column } = lineAndColumn(s);
      spans.push({ start: s, end: e, startLine: line, startColumn: column });
    }
    elementStart = -1;
  };

  const beginElementIfNeeded = (i: number) => {
    if (elementStart === -1 && !/\s/.test(text[i]!)) elementStart = i;
  };

  for (let i = openBracket; i < text.length; i++) {
    const ch = text[i]!;

    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }

    if (ch === '"') {
      inString = true;
      if (depth === 1) beginElementIfNeeded(i);
      continue;
    }

    if (ch === '[' || ch === '{') {
      depth++;
      if (depth === 2 || (depth === 1 && i === openBracket)) {
        // depth===2：顶层元素本身开始（[ 或 {）；depth===1 是外层数组自己
        if (depth === 2) elementStart = i;
      }
      continue;
    }

    if (ch === ']' || ch === '}') {
      if (depth === 2) {
        // 顶层元素结束
        pushSpan(i + 1);
        depth--;
        continue;
      }
      if (depth === 1 && ch === ']') {
        pushSpan(i);
        return spans;
      }
      depth--;
      continue;
    }

    if (depth === 1) {
      if (ch === ',') {
        pushSpan(i);
      } else {
        beginElementIfNeeded(i);
      }
    }
  }

  return spans;
}
