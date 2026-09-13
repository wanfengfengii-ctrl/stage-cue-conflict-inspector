/**
 * 时间轴交集热区的点击命中解析。
 *
 * 背景：交集标记是普通按钮，浏览器只把点击交给最上层那个元素——
 *   1. 同一设备的多组争用完全重叠时，多组标记叠在同一个盒里，只有 DOM 顺序最后
 *      一组能收到点击；
 *   2. 紧凑轴为亚像素的 1ms 争用扩展了最小点击热区（向右扩），相邻争用的扩展
 *      热区互相覆盖，点前一处会被后一处（DOM 更上层）截获。
 *
 * 因此【每个】交集按钮被点中后都不直接使用自己的身份，而是统一调用本解析器：
 * 按点击坐标在该行全部热区中重新判定归属，归属只取决于用户指向的位置
 * 与各可见热区的关系，与 DOM 叠放顺序无关；同一位置叠放多组争用时逐组轮换
 * 选择，支持逐组核对。
 */

/** 一个交集标记的几何（单位：像素，相对资源轨道左缘）。 */
export interface OverlapHit {
  /** 争用选择身份键（conflictKey，无碰撞）。 */
  key: string;
  /** 真实交集的渲染左缘：始终精确取自时间映射。 */
  realLeft: number;
  /** 真实交集的渲染宽度（紧凑轴 1ms 争用时可能不足 1px）。 */
  realWidth: number;
  /** 实际生效的点击热区左缘（可能相对真实盒扩展）。 */
  hotLeft: number;
  /** 实际生效的点击热区宽度（如紧凑轴最小 6px 热区，向右微扩）。 */
  hotWidth: number;
}

function hotCenter(hit: OverlapHit): number {
  return hit.hotLeft + hit.hotWidth / 2;
}

function realContains(hit: OverlapHit, x: number): boolean {
  return x >= hit.realLeft && x <= hit.realLeft + hit.realWidth;
}

/**
 * 在给定横向坐标上按用户指向选出唯一争用；坐标不在任何热区内时返回 undefined
 * （调用方应忽略本次点击，不改动选择）。
 *
 * 选择规则（候选 = 热区盒包含 x 的全部争用，允许热区重叠时多组并存）：
 * - 首选真实交集盒包含 x 者（点在真实交集上，任何扩展热区都不得把它抢走）；
 * - 其余按点击点距【自身热区中心】的距离升序：扩展热区彼此覆盖处，点中前一个
 *   可见标记的中心时，它到自身热区中心距离为 0，必然胜过后一个标记——
 *   归属与用户指向的交集一致，而不是 DOM 最上层的那个；
 * - 再按真实左缘、输入次序兜底，结果确定可复现（完全重叠的多组争用几何全同，
 *   稳定取到候选中的第一组）；
 * - 已选中某争用时：点在【真实叠放点】（多组真实交集同时包含该点，或都不包含
 *   且到各自热区中心距离并列）时沿候选顺序逐组轮换核对；点在仅属于当前选中
 *   争用的真实交集上则取消（保留开关语义）；点向另一组的真实交集则直接改选，
 *   即选择始终与用户指向的交集一致。
 */
export function pickOverlap(
  hits: readonly OverlapHit[],
  x: number,
  selectedKey: string | null,
): string | null | undefined {
  const candidates = hits.filter((h) => x >= h.hotLeft && x <= h.hotLeft + h.hotWidth);
  if (candidates.length === 0) return undefined;

  const centerDist = (h: OverlapHit) => Math.abs(x - hotCenter(h));
  const rank = (a: OverlapHit, b: OverlapHit): number => {
    const aContains = realContains(a, x) ? 1 : 0;
    const bContains = realContains(b, x) ? 1 : 0;
    if (aContains !== bContains) return bContains - aContains;
    const distDiff = centerDist(a) - centerDist(b);
    if (distDiff !== 0) return distDiff;
    if (a.realLeft !== b.realLeft) return a.realLeft - b.realLeft;
    // 几何完全一致（完全重叠的多组争用）：退回输入中的稳定先后次序
    return hits.indexOf(a) - hits.indexOf(b);
  };

  const preferred = candidates.slice().sort(rank)[0]!;

  if (selectedKey === null || !candidates.some((h) => h.key === selectedKey)) {
    return preferred.key;
  }

  // 是否为“真实叠放点”：多组真实交集同时压在该点；或点击只落在扩展热区上时，
  // 首选与次选到各自热区中心的距离并列（无法按指向区分）。
  const containingCount = candidates.filter((h) => realContains(h, x)).length;
  let stacked = containingCount > 1;
  if (containingCount === 0 && candidates.length > 1) {
    const distances = candidates.map(centerDist).sort((a, b) => a - b);
    stacked = distances[0] === distances[1];
  }

  if (!stacked) {
    // 指向唯一明确：点在当前选中项上即取消，否则改选指向的那一组
    return preferred.key === selectedKey ? null : preferred.key;
  }

  // 同一点叠放多组：沿候选顺序逐组轮换（c1→c2→…→cn→取消→c1…），
  // 既能逐组核对，也保留回到未选中的路径。候选顺序与冲突列表次序一致。
  const selectedIndex = candidates.findIndex((h) => h.key === selectedKey);
  if (selectedIndex + 1 >= candidates.length) return null;
  return candidates[selectedIndex + 1]!.key;
}
