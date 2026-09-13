import { describe, expect, it } from 'vitest';
import {
  compareByCodePoint,
  conflictKey,
  detectConflicts,
  parseAndValidate,
  validateBatch,
  validateItem,
} from './conflicts';
import type { CueItem } from './types';
import { MS_PER_DAY } from './types';

const cue = (id: string, resource: string, startMs: number, endMs: number): CueItem => ({
  id,
  resource,
  startMs,
  endMs,
});

describe('validateItem', () => {
  it('接受字段齐全的合法条目', () => {
    expect(validateItem(cue('a', '灯光', 0, 100), 0)).toEqual([]);
  });

  it('拒绝非对象：null、数组、数字、字符串', () => {
    expect(validateItem(null, 0)).toHaveLength(1);
    expect(validateItem([], 1)[0]!.index).toBe(1);
    expect(validateItem(42, 2)[0]!.message).toContain('JSON 对象');
    expect(validateItem('x', 3)[0]!.message).toContain('JSON 对象');
  });

  it('对每个缺失/非法字段分别给出原因', () => {
    const issues = validateItem({}, 0);
    expect(issues.map((i) => i.message)).toEqual([
      expect.stringContaining('id'),
      expect.stringContaining('resource'),
      expect.stringContaining('startMs'),
      expect.stringContaining('endMs'),
    ]);
  });

  it('拒绝空字符串 id 与 resource', () => {
    const issues = validateItem({ id: '', resource: '', startMs: 0, endMs: 1 }, 4);
    expect(issues.map((i) => i.message).join('|')).toContain('id 必须是非空字符串');
    expect(issues.map((i) => i.message).join('|')).toContain('resource 必须是非空字符串');
    expect(issues.every((i) => i.index === 4)).toBe(true);
  });

  it('拒绝非整数与超出 0..86400000 的时间', () => {
    const bad = [
      { id: 'a', resource: 'r', startMs: 1.5, endMs: 2 },
      { id: 'a', resource: 'r', startMs: -1, endMs: 2 },
      { id: 'a', resource: 'r', startMs: 0, endMs: MS_PER_DAY + 1 },
      { id: 'a', resource: 'r', startMs: NaN, endMs: 2 },
      { id: 'a', resource: 'r', startMs: Infinity, endMs: 2 },
    ];
    for (const item of bad) {
      expect(validateItem(item, 0).length).toBeGreaterThan(0);
    }
  });

  it('接受边界 0 与 86400000（start < end）', () => {
    expect(validateItem(cue('a', 'r', 0, MS_PER_DAY), 0)).toEqual([]);
  });

  it('拒绝 startMs 等于或大于 endMs', () => {
    expect(
      validateItem({ id: 'a', resource: 'r', startMs: 100, endMs: 100 }, 0)[0]!.message,
    ).toContain('严格小于');
    expect(
      validateItem({ id: 'a', resource: 'r', startMs: 101, endMs: 100 }, 0)[0]!.message,
    ).toContain('严格小于');
  });

  it('拒绝布尔与字符串形式的数字（不做隐式类型转换）', () => {
    expect(
      validateItem({ id: 1, resource: 'r', startMs: 0, endMs: 1 }, 0).length,
    ).toBeGreaterThan(0);
    expect(
      validateItem({ id: 'a', resource: 'r', startMs: '0', endMs: '1' }, 0).length,
    ).toBeGreaterThan(0);
  });
});

describe('validateBatch / parseAndValidate', () => {
  it('拒绝非数组、空数组与空文本', () => {
    const notArray = validateBatch({});
    expect(notArray.ok).toBe(false);
    if (!notArray.ok) expect(notArray.issues[0]!.index).toBe(-1);
    const stringNotArray = validateBatch('[]');
    expect(stringNotArray.ok).toBe(false);
    if (!stringNotArray.ok) expect(stringNotArray.issues[0]!.index).toBe(-1);
    const emptyBatch = validateBatch([]);
    expect(emptyBatch.ok).toBe(false);
    if (!emptyBatch.ok) expect(emptyBatch.issues[0]!.message).toContain('数组为空');
    const emptyText = parseAndValidate('');
    expect(emptyText.ok).toBe(false);
    if (!emptyText.ok) expect(emptyText.issues[0]!.message).toContain('尚未粘贴');
  });

  it('拒绝语法错误的 JSON 并报告解析原因', () => {
    const result = parseAndValidate('[{"id":"a",}]');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues[0]!.message).toContain('JSON 语法错误');
  });

  it('合法批次通过', () => {
    const result = parseAndValidate('[{"id":"a","resource":"r","startMs":0,"endMs":1}]');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.items[0]!.id).toBe('a');
  });

  it('id 重复时整批拒绝，并在重复条目附近反馈', () => {
    const result = validateBatch([
      cue('dup', 'r', 0, 10),
      cue('other', 'r', 0, 10),
      cue('dup', 'r', 20, 30),
    ]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const dupIssue = result.issues.find((i) => i.message.includes('"dup" 重复'));
      expect(dupIssue?.index).toBe(2);
      expect(dupIssue!.message).toContain('首次出现于第 1 条');
    }
  });

  it('同时存在非法条目与重复 id 时一次性报告所有问题', () => {
    const result = validateBatch([
      cue('x', 'r', 0, 10),
      { id: 'x', resource: 'r', startMs: 5, endMs: 4 },
      cue('z', 'r', 0, 10),
    ]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.some((i) => i.index === 1 && i.message.includes('严格小于'))).toBe(true);
      expect(result.issues.some((i) => i.index === 1 && i.message.includes('"x" 重复'))).toBe(true);
    }
  });
});

describe('compareByCodePoint', () => {
  it('按 Unicode 码点排序 ASCII（不做自然排序）', () => {
    expect(['b', 'A', 'a', '10', '2', ''].sort(compareByCodePoint)).toEqual([
      '',
      '10',
      '2',
      'A',
      'a',
      'b',
    ]);
  });

  it('正确处理 BMP 外字符（代理对按码位而非码元）', () => {
    // U+E000（57344）与 😀 U+1F600（128512）：按码点 E000 在前；
    // 但 😀 的首个 UTF-16 码元是 0xD83D（55357）< 0xE000，按码元排序结果相反。
    const bmpHigh = String.fromCodePoint(0xe000); // BMP 尾部：私用区首码点
    const astral = String.fromCodePoint(0x1f600); // 增补平面：😀
    expect(compareByCodePoint(bmpHigh, astral)).toBeLessThan(0);
    expect(bmpHigh < astral).toBe(false);
    expect([astral, bmpHigh].sort(compareByCodePoint)).toEqual([bmpHigh, astral]);
  });

  it('前缀关系：较短字符串在前', () => {
    expect(compareByCodePoint('ab', 'abc')).toBeLessThan(0);
    expect(compareByCodePoint('abc', 'ab')).toBeGreaterThan(0);
    expect(compareByCodePoint('ab', 'ab')).toBe(0);
  });
});

describe('detectConflicts', () => {
  it('无重叠时返回空数组（贴边 end===start 不冲突）', () => {
    const items = [cue('a', '灯光', 0, 100), cue('b', '灯光', 100, 200)];
    expect(detectConflicts(items)).toEqual([]);
  });

  it('交集 1ms 即构成冲突，逐毫秒定位', () => {
    const conflicts = detectConflicts([cue('a', '雾机', 99, 100), cue('b', '雾机', 100, 101)]);
    expect(conflicts).toEqual([]);
    const oneMs = detectConflicts([cue('a', '雾机', 99, 101), cue('b', '雾机', 100, 101)]);
    expect(oneMs).toEqual([
      {
        resource: '雾机',
        idA: 'a',
        idB: 'b',
        overlapStart: 100,
        overlapEnd: 101,
        overlapDuration: 1,
      },
    ]);
  });

  it('仅同一 resource 内检测，跨资源相同时间段不冲突', () => {
    const conflicts = detectConflicts([
      cue('a', '灯光A', 0, 100),
      cue('b', '灯光B', 0, 100),
    ]);
    expect(conflicts).toEqual([]);
  });

  it('处理包含与被包含区间', () => {
    const conflicts = detectConflicts([
      cue('outer', '升降台-主', 0, 1000),
      cue('inner', '升降台-主', 100, 200),
    ]);
    expect(conflicts).toEqual([
      {
        resource: '升降台-主',
        idA: 'inner',
        idB: 'outer',
        overlapStart: 100,
        overlapEnd: 200,
        overlapDuration: 100,
      },
    ]);
  });

  it('三个重叠项两两成对，每对只出现一次', () => {
    const conflicts = detectConflicts([
      cue('a', 'r', 0, 10),
      cue('b', 'r', 5, 15),
      cue('c', 'r', 8, 20),
    ]);
    expect(conflicts).toHaveLength(3);
    const pairs = conflicts.map((c) => `${c.idA}|${c.idB}`);
    expect(new Set(pairs).size).toBe(3);
    expect(pairs).toEqual(['a|b', 'a|c', 'b|c']);
  });

  it('按 resource、重叠起点、较小 id、较大 id 的码点顺序排序', () => {
    const conflicts = detectConflicts([
      cue('b', '雾机', 0, 10),
      cue('a', '雾机', 9, 20), // 雾机上的重叠起点 9
      cue('y', '灯光', 0, 10),
      cue('x', '灯光', 0, 10), // 灯光上的重叠起点 0，应整体排在雾机之前
    ]);
    expect(conflicts.map((c) => `${c.resource}:${c.overlapStart}:${c.idA}<${c.idB}`)).toEqual([
      '灯光:0:x<y',
      '雾机:9:a<b',
    ]);
  });

  it('同一起点时按 id 码点次序排列', () => {
    const conflicts = detectConflicts([
      cue('B', 'r', 0, 10),
      cue('a', 'r', 0, 10),
      cue('A', 'r', 0, 10),
    ]);
    // 3 对：A<B, A<a, B<a，重叠起点全为 0
    expect(conflicts.map((c) => `${c.idA}|${c.idB}`)).toEqual(['A|B', 'A|a', 'B|a']);
  });

  it('多资源混合且贴边不误报', () => {
    const conflicts = detectConflicts([
      cue('l1', '灯光', 0, 100),
      cue('l2', '灯光', 100, 200), // 贴边
      cue('l3', '灯光', 150, 250), // 与 l2 在 [150,200) 冲突
      cue('f1', '雾机', 0, 100),
      cue('f2', '雾机', 50, 150), // 与 f1 在 [50,100) 冲突
    ]);
    expect(conflicts).toHaveLength(2);
    // 灯光(码点) 与 雾机 排序：比较 U+706F vs U+706F... '灯' U+706F, '雾' U+96FE
    expect(conflicts[0]).toMatchObject({ resource: '灯光', overlapStart: 150, overlapEnd: 200 });
    expect(conflicts[1]).toMatchObject({ resource: '雾机', overlapStart: 50, overlapEnd: 100 });
  });

  it('空输入（已被校验拦截的情形）返回空数组', () => {
    expect(detectConflicts([])).toEqual([]);
  });
});

describe('conflictKey', () => {
  const make = (
    resource: string,
    idA: string,
    idB: string,
    overlapStart: number,
    overlapEnd: number,
  ) => ({ resource, idA, idB, overlapStart, overlapEnd, overlapDuration: overlapEnd - overlapStart });

  it('同一争用跨渲染稳定相等，不同争用不相等', () => {
    expect(conflictKey(make('r', 'a', 'b', 0, 10))).toBe(conflictKey(make('r', 'a', 'b', 0, 10)));
    expect(conflictKey(make('r', 'a', 'b', 0, 10))).not.toBe(conflictKey(make('r', 'a', 'c', 0, 10)));
  });

  it('编号含合法空字符 U+0000 时两对不同争用不撞键（旧 NUL 分隔键的真实缺陷）', () => {
    // 旧键以裸 NUL 连接字段；而 JSON 转义 \u0000 可把 NUL 合法放进字符串，于是：
    //   ("a","x<NUL>y") 的键 == ("a<NUL>x","y") 的键（字节完全相同），
    // 旧实现点击其中一条会同时高亮两条。新键经 JSON 引号定界，二者必须不同。
    const first = conflictKey(make('r', 'a', 'x\u0000y', 0, 200));
    const second = conflictKey(make('r', 'a\u0000x', 'y', 0, 200));
    expect(first).not.toBe(second);
  });

  it('资源名含合法空字符 U+0000 同样不撞键', () => {
    const first = conflictKey(make('r\u0000R', 'a', 'b', 0, 200));
    const second = conflictKey(make('r', 'a', 'b', 0, 200));
    expect(first).not.toBe(second);
  });

  it('字段含空格时朴素拼接会撞的两种切分得到不同身份', () => {
    // "a"+"b c" 与 "a b"+"c"：朴素空格拼接键完全相同；引号定界后分开
    const first = conflictKey(make('r', 'a', 'b c', 0, 10));
    const second = conflictKey(make('r', 'a b', 'c', 0, 10));
    expect(first).not.toBe(second);
  });

  it('分隔符 U+001F 不会被字段内容仿冒：字段内的同款字符经 JSON 转义', () => {
    const sep = '\u001f';
    const injected = conflictKey(make('r\u001fr', 'a', 'b', 0, 10));
    const normal = conflictKey(make('r', 'a', 'b', 0, 10));
    expect(injected).not.toBe(normal);
    // 键含五个字段；字段内的 U+001F 被 JSON.stringify 转义成 \u001f，
    // 不会产生额外裸分隔符，切分仍为五段
    expect(injected.split(sep)).toHaveLength(5);
    expect(normal.split(sep)).toHaveLength(5);
  });

  it('资源名含空格时两条不同资源争用不撞键', () => {
    const one = conflictKey(make('设备 A', 'a', 'b', 0, 10));
    const two = conflictKey(make('设备', 'a', 'b', 0, 10));
    expect(one).not.toBe(two);
  });

  it('同对 id 的不同交集区间身份不同（键含完整重叠区间）', () => {
    expect(conflictKey(make('r', 'a', 'b', 0, 1))).not.toBe(
      conflictKey(make('r', 'a', 'b', 5, 6)),
    );
  });
});
