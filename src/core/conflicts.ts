import type {
  Conflict,
  CueItem,
  RawItem,
  ValidationFailure,
  ValidationIssue,
  ValidationResult,
} from './types';
import { MS_PER_DAY } from './types';

/**
 * 判断一个数值是否为“安全整数”。
 * 使用 Number.isSafeInteger 而非 Number.isInteger：时间以毫秒计，
 * 超出安全整数范围的数字无法逐毫秒精确定位，应当拒绝。
 */
function isSafeInt32Range(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

/**
 * 校验单条提示。
 *
 * @param value 解析后的原始条目
 * @param index 该条目在输入数组中的下标（用于就近反馈）
 * @returns 该条目的全部问题；空数组表示合法
 */
export function validateItem(value: RawItem, index: number): ValidationIssue[] {
  const issues: string[] = [];

  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return [{ index, message: `第 ${index + 1} 条：必须是 JSON 对象，收到的是 ${typeDescription(value)}。` }];
  }

  const record = value as Record<string, unknown>;

  // id：非空字符串
  if (!('id' in record)) {
    issues.push('缺少字段 id（必须是非空字符串，且整批唯一）。');
  } else if (!isNonEmptyString(record.id)) {
    issues.push(`字段 id 必须是非空字符串，收到的是 ${typeDescription(record.id)}。`);
  }

  // resource：非空字符串
  if (!('resource' in record)) {
    issues.push('缺少字段 resource（必须是非空字符串，例如设备名）。');
  } else if (!isNonEmptyString(record.resource)) {
    issues.push(`字段 resource 必须是非空字符串，收到的是 ${typeDescription(record.resource)}。`);
  }

  // startMs / endMs：[0, 86400000] 内的整数，且 startMs < endMs
  const rawStart = 'startMs' in record ? record.startMs : undefined;
  const rawEnd = 'endMs' in record ? record.endMs : undefined;
  const startOk = isSafeInt32Range(rawStart) && rawStart >= 0 && rawStart <= MS_PER_DAY;
  const endOk = isSafeInt32Range(rawEnd) && rawEnd >= 0 && rawEnd <= MS_PER_DAY;

  if (!('startMs' in record)) {
    issues.push('缺少字段 startMs。');
  } else if (!startOk) {
    issues.push(
      `字段 startMs 必须是 0 到 ${MS_PER_DAY}（含）之间的整数毫秒，收到的是 ${literalDescription(rawStart)}。`,
    );
  }

  if (!('endMs' in record)) {
    issues.push('缺少字段 endMs。');
  } else if (!endOk) {
    issues.push(
      `字段 endMs 必须是 0 到 ${MS_PER_DAY}（含）之间的整数毫秒，收到的是 ${literalDescription(rawEnd)}。`,
    );
  }

  if (startOk && endOk && rawStart >= rawEnd) {
    issues.push(
      `字段 startMs（${rawStart}）必须严格小于 endMs（${rawEnd}），区间为 [startMs, endMs)。`,
    );
  }

  return issues.map((message) => ({ index, message }));
}

function typeDescription(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return '数组';
  return typeof value === 'number' ? `数字 ${literalDescription(value)}` : typeof value;
}

function literalDescription(value: unknown): string {
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : String(value);
  return JSON.stringify(value);
}

/**
 * 校验整批输入。
 *
 * 规则：
 * - 必须是 JSON 数组；
 * - 数组不能为空；
 * - 每条必须含唯一字符串 id、非空 resource、范围内整数 startMs/endMs 且 startMs < endMs；
 * - 任意一条非法或 id 重复即整批拒绝（返回全部问题，调用方不得沿用旧结果）。
 *
 * @param data JSON.parse 的结果
 */
export function validateBatch(data: unknown): ValidationResult {
  if (!Array.isArray(data)) {
    return {
      ok: false,
      issues: [{ index: -1, message: '输入必须是 JSON 数组，例如 [ { "id": "c1", ... } ]。' }],
    };
  }

  if (data.length === 0) {
    return {
      ok: false,
      issues: [{ index: -1, message: '数组为空：请至少粘贴一条提示。' }],
    };
  }

  const issues: ValidationIssue[] = [];
  const items: CueItem[] = [];
  const idFirstIndex = new Map<string, number>();
  const duplicateIds = new Set<string>();

  data.forEach((raw, index) => {
    const itemIssues = validateItem(raw, index);
    issues.push(...itemIssues);

    if (itemIssues.length === 0) {
      items.push(raw as CueItem);
    }

    // id 查重独立于其它字段：即使该条目的 startMs 等字段非法，
    // 只要 id 本身是非空字符串，重复问题仍要在本条目附近一次性报告。
    if (typeof raw === 'object' && raw !== null && !Array.isArray(raw)) {
      const id = (raw as Record<string, unknown>).id;
      if (typeof id === 'string' && id.length > 0) {
        const first = idFirstIndex.get(id);
        if (first === undefined) idFirstIndex.set(id, index);
        else duplicateIds.add(id);
      }
    }
  });

  // 重复 id：在每个重复出现的条目上就近标注（含第一次出现的位置）
  if (duplicateIds.size > 0) {
    const seen = new Set<string>();
    data.forEach((raw, index) => {
      if (typeof raw === 'object' && raw !== null && !Array.isArray(raw)) {
        const id = (raw as Record<string, unknown>).id;
        if (typeof id === 'string' && duplicateIds.has(id)) {
          if (seen.has(id)) {
            issues.push({
              index,
              message: `id "${id}" 重复：id 必须在整批输入中唯一（首次出现于第 ${idFirstIndex.get(id)! + 1} 条）。`,
            });
          }
          seen.add(id);
        }
      }
    });
  }

  if (issues.length > 0) {
    // 问题按下标归并稳定排序，顶层问题（-1）置顶
    issues.sort((a, b) => a.index - b.index);
    return { ok: false, issues };
  }

  return { ok: true, items };
}

/**
 * 解析并校验舞台监督粘贴的 JSON 文本。
 * JSON 语法错误同样整批拒绝，问题归到顶层。
 */
export function parseAndValidate(text: string): ValidationResult {
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    return {
      ok: false,
      issues: [{ index: -1, message: '尚未粘贴任何内容：请输入 JSON 数组。' }],
    };
  }

  let data: unknown;
  try {
    data = JSON.parse(trimmed);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      issues: [{ index: -1, message: `JSON 语法错误，无法解析：${reason}` }],
    };
  }

  return validateBatch(data);
}

/**
 * 按 Unicode 码点（码位）比较两个字符串，等价于按 [...s] 排列。
 * 对多码元字符（如部分 emoji）与 String.localeCompare 区分开，
 * 严格遵循“Unicode 码点顺序”。
 */
export function compareByCodePoint(a: string, b: string): number {
  const cpsA = Array.from(a);
  const cpsB = Array.from(b);
  const len = Math.min(cpsA.length, cpsB.length);
  for (let i = 0; i < len; i++) {
    const diff = cpsA[i].codePointAt(0)! - cpsB[i].codePointAt(0)!;
    if (diff !== 0) return diff;
  }
  return cpsA.length - cpsB.length;
}

/**
 * 检测同一 resource 上交集长度严格大于零的所有提示对。
 *
 * 半开区间 [start, end) 的重叠：
 *   overlapStart = max(start1, start2)
 *   overlapEnd   = min(end1, end2)
 * 仅当 overlapEnd > overlapStart 时构成冲突。
 * endA === startB 的贴边情形 overlap 长度为 0，明确不报。
 *
 * 输出排序键：resource → 重叠起点 → 较小 id → 较大 id（均按 Unicode 码点顺序）。
 * 每对只出现一次。
 */
export function detectConflicts(items: CueItem[]): Conflict[] {
  const byResource = new Map<string, CueItem[]>();
  for (const item of items) {
    const list = byResource.get(item.resource);
    if (list) list.push(item);
    else byResource.set(item.resource, [item]);
  }

  const conflicts: Conflict[] = [];

  for (const [resource, list] of byResource) {
    if (list.length < 2) continue;

    // 按起点排序后用扫线，避免 O(n²) 全比较；同起点时用 id 码点序保证稳定
    const sorted = [...list].sort((a, b) => a.startMs - b.startMs || compareByCodePoint(a.id, b.id));

    for (let i = 0; i < sorted.length; i++) {
      for (let j = i + 1; j < sorted.length; j++) {
        const a = sorted[i];
        const b = sorted[j];

        // 半开区间：b.startMs >= a.endMs 之后，与后续项都不可能再相交
        if (b.startMs >= a.endMs) break;

        const overlapStart = Math.max(a.startMs, b.startMs);
        const overlapEnd = Math.min(a.endMs, b.endMs);
        if (overlapEnd <= overlapStart) continue; // 长度为 0（贴边）不算冲突

        const [idA, idB] =
          compareByCodePoint(a.id, b.id) <= 0 ? [a.id, b.id] : [b.id, a.id];

        conflicts.push({
          resource,
          idA,
          idB,
          overlapStart,
          overlapEnd,
          overlapDuration: overlapEnd - overlapStart,
        });
      }
    }
  }

  conflicts.sort((x, y) => {
    const byResource = compareByCodePoint(x.resource, y.resource);
    if (byResource !== 0) return byResource;
    if (x.overlapStart !== y.overlapStart) return x.overlapStart - y.overlapStart;
    const byIdA = compareByCodePoint(x.idA, y.idA);
    if (byIdA !== 0) return byIdA;
    return compareByCodePoint(x.idB, y.idB);
  });

  return conflicts;
}

/** 便捷类型守卫，供 UI 收窄失败结果。 */
export function isFailure(result: ValidationResult): result is ValidationFailure {
  return !result.ok;
}
