import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import App from './App';
import { SAMPLE_CONFLICT } from './samples';

/**
 * 聚焦上下文 + 时刻游标的 React 交互测试（jsdom）：
 * 领域投影由 focusWindow / compactScale / momentCursor 的纯函数测试保证，
 * 这里只验证装配行为——窗口内呈现、切模式只重算坐标、完全重叠争用逐组轮换、
 * 选择失效就近反馈并退焦、编辑清除聚焦；
 * 以及时刻游标：刻度带落点设置/移动、切模式后标线与详情仍指向同一真实时刻、
 * 无占用时刻提示、聚焦窗口外清除游标、重置链路撤下游标。
 */

// 锚冲突 (a,b) 交集 [630000,660000) → 聚焦窗口固定为 [600000,690000)。
// t 跨右边界但不与任何窗内提示冲突（start 680000 ≥ b 的 end 670000）；
// e 的 end 恰好等于窗口左缘、s 完全在窗口右侧（与 t 贴边）；d 与雾机两组远在他处。
const CUES_NEAR_AND_FAR = `[
  { "id": "a", "resource": "灯杆-1", "startMs": 600000, "endMs": 660000 },
  { "id": "b", "resource": "灯杆-1", "startMs": 630000, "endMs": 670000 },
  { "id": "t", "resource": "灯杆-1", "startMs": 680000, "endMs": 750000 },
  { "id": "e", "resource": "灯杆-1", "startMs": 500000, "endMs": 600000 },
  { "id": "s", "resource": "灯杆-1", "startMs": 750000, "endMs": 800000 },
  { "id": "d", "resource": "远处-灯杆", "startMs": 80000000, "endMs": 80100000 },
  { "id": "f", "resource": "雾机-上场门", "startMs": 60000000, "endMs": 60100000 },
  { "id": "g", "resource": "雾机-上场门", "startMs": 60050000, "endMs": 60200000 }
]`;

afterEach(() => {
  // vitest 未开启 globals，RTL 不会自动 cleanup，显式卸载
  cleanup();
});

function cueTitles(): string[] {
  return [...document.querySelectorAll('.cue-block')].map((el) => el.getAttribute('title') ?? '');
}

/**
 * jsdom 无布局：给刻度带一个确定宽度，使整日模式下 1px = 1000ms
 * （clientX 630 → 真实时刻 630_000ms），返回刻度带元素。
 * 元素在重渲染间保持同一 DOM 节点，但切模式 / 换批次后重新 mock 更直观。
 */
function mockRulerCanvas(width = 86_400): HTMLElement {
  const canvas = document.querySelector('.ruler-canvas') as HTMLElement;
  canvas.getBoundingClientRect = () =>
    ({
      left: 0,
      top: 0,
      width,
      height: 28,
      right: width,
      bottom: 28,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    }) as DOMRect;
  return canvas;
}

function cursorLineMoments(): string[] {
  return [...document.querySelectorAll('.cursor-line')].map(
    (el) => el.getAttribute('data-moment') ?? '',
  );
}

describe('聚焦上下文主链路', () => {
  it('进入聚焦后窗口内只呈现相交提示/冲突；切紧凑再回整日只重算坐标，窗口与选中不变；退出后恢复完整演出且选择保留', () => {
    const { container } = render(<App />);
    fireEvent.change(screen.getByLabelText('JSON 数组输入区'), { target: { value: CUES_NEAR_AND_FAR } });

    const cards = screen.getAllByTestId('conflict-card');
    expect(cards).toHaveLength(2);
    // 完整演出：8 条提示全部上屏，2 处冲突
    expect(cueTitles()).toHaveLength(8);
    expect(container.querySelectorAll('.overlap')).toHaveLength(2);

    // 选中锚冲突 (a,b) → 出现“聚焦上下文”入口
    fireEvent.click(cards[0]!);
    const focusButton = screen.getByTestId('focus-button');
    fireEvent.click(focusButton);

    // 窗口 = 交集 [630000,660000) 两侧各 30 秒 → [600000,690000)，日界内
    const banner = screen.getByTestId('focus-banner');
    expect(banner.textContent).toContain('10:00.000');
    expect(banner.textContent).toContain('11:30.000');
    expect(screen.queryByTestId('focus-button')).toBeNull();

    // 窗口内提示：a、b（内含）与 t（跨右边界裁短）；
    // e 的 end === 窗口左缘、s 完全在窗口右侧（恰好贴边，半开不算）与远处 d 全部不呈现
    const titles = cueTitles();
    expect(titles.map((t) => t.slice(0, 1)).sort()).toEqual(['a', 'b', 't']);
    // 跨边界图形裁短但绝对毫秒值与标签保持原样：t 的 title 仍是真实 endMs=750000
    expect(titles.find((t) => t.startsWith('t'))).toBe('t [11:20.000 → 12:30.000)');
    expect(titles.some((t) => t.startsWith('e'))).toBe(false);
    expect(titles.some((t) => t.startsWith('s'))).toBe(false);
    expect(titles.some((t) => t.startsWith('d'))).toBe(false);

    // 窗口内只呈现相交的那一处冲突；冲突列表仍是原有对象（两张卡片都在）
    expect(container.querySelectorAll('.overlap')).toHaveLength(1);
    expect(screen.getAllByTestId('conflict-card')).toHaveLength(2);
    // 锚卡片仍处于选中态
    expect(cards[0]!.className).toMatch(/active/);

    // 聚焦期间切到紧凑：只重算坐标（data-mode 变化），窗口横幅、选中项、窗口内元素均不变
    fireEvent.click(screen.getByTestId('mode-toggle'));
    expect(screen.getByTestId('timeline-inner').getAttribute('data-mode')).toBe('compact');
    expect(screen.getByTestId('focus-banner')).toBeTruthy();
    expect(cueTitles()).toHaveLength(3);
    expect(container.querySelectorAll('.overlap')).toHaveLength(1);
    expect(cards[0]!.className).toMatch(/active/);

    // 切回整日：窗口依旧
    fireEvent.click(screen.getByTestId('mode-toggle'));
    expect(screen.getByTestId('timeline-inner').getAttribute('data-mode')).toBe('day');
    expect(screen.getByTestId('focus-banner')).toBeTruthy();
    expect(cueTitles()).toHaveLength(3);

    // 退出聚焦：完整演出恢复，选中项原样保留
    fireEvent.click(screen.getByTestId('exit-focus'));
    expect(screen.queryByTestId('focus-banner')).toBeNull();
    expect(cueTitles()).toHaveLength(8);
    expect(container.querySelectorAll('.overlap')).toHaveLength(2);
    expect(cards[0]!.className).toMatch(/active/);
  });

  it('聚焦期间完全重叠的三组争用仍可逐组选择；点选窗口外争用则就近反馈并退出聚焦', () => {
    const { container } = render(<App />);
    fireEvent.change(screen.getByLabelText('JSON 数组输入区'), {
      target: {
        value: `[
  { "id": "a", "resource": "r1", "startMs": 100000, "endMs": 200000 },
  { "id": "b", "resource": "r1", "startMs": 100000, "endMs": 200000 },
  { "id": "c", "resource": "r1", "startMs": 100000, "endMs": 200000 },
  { "id": "x", "resource": "r2", "startMs": 80000000, "endMs": 80100000 },
  { "id": "y", "resource": "r2", "startMs": 80000000, "endMs": 80100000 }
]`,
      },
    });

    const cards = screen.getAllByTestId('conflict-card');
    expect(cards).toHaveLength(4);

    // 选中第一组并聚焦（窗口 [70000,230000) 完整覆盖三组重叠争用）
    fireEvent.click(cards[0]!);
    fireEvent.click(screen.getByTestId('focus-button'));
    const overlaps = container.querySelectorAll('.overlap');
    expect(overlaps).toHaveLength(3);
    expect(screen.getByTestId('focus-banner')).toBeTruthy();

    const clickStack = () => fireEvent.click(overlaps[0]!);
    // 三个交集几何完全一致，且锚点 card0 已选中：同一点逐组轮换
    // card0 → card1 → card2 → 取消 → card0 …，每次仅一组高亮
    expect(cards[0]!.className).toMatch(/active/);
    clickStack();
    expect(cards[1]!.className).toMatch(/active/);
    expect(container.querySelectorAll('.overlap.active')).toHaveLength(1);
    clickStack();
    expect(cards[1]!.className).not.toMatch(/active/);
    expect(cards[2]!.className).toMatch(/active/);
    expect(container.querySelectorAll('.overlap.active')).toHaveLength(1);
    clickStack();
    expect(container.querySelectorAll('.conflict-card.active')).toHaveLength(0);
    expect(container.querySelectorAll('.overlap.active')).toHaveLength(0);
    clickStack();
    expect(cards[0]!.className).toMatch(/active/);
    // 轮换全程窗口不变
    expect(screen.getByTestId('focus-banner')).toBeTruthy();

    // 在列表中点选窗口【外】的 r2 争用：选择在当前窗口失效 → 就近反馈 + 退出聚焦 + 定位该争用
    fireEvent.click(cards[3]!);
    const notice = screen.getByTestId('focus-notice');
    expect(notice.textContent).toContain('不在当前聚焦窗口内');
    expect(notice.textContent).toContain('已退出聚焦');
    expect(screen.queryByTestId('focus-banner')).toBeNull();
    expect(cards[3]!.className).toMatch(/active/);
    // 退出后完整演出的交集都回来了（3 + 1）
    expect(container.querySelectorAll('.overlap')).toHaveLength(4);
  });
});

describe('编辑 / 粘贴 / 载入示例清除聚焦', () => {
  it('聚焦且紧凑时粘贴新批次：恢复整日、退出聚焦；非法输入整批撤下', () => {
    render(<App />);
    const textarea = screen.getByLabelText('JSON 数组输入区') as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: SAMPLE_CONFLICT } });

    let cards = screen.getAllByTestId('conflict-card');
    fireEvent.click(cards[0]!);
    fireEvent.click(screen.getByTestId('focus-button'));
    fireEvent.click(screen.getByTestId('mode-toggle'));
    expect(screen.getByTestId('timeline-inner').getAttribute('data-mode')).toBe('compact');
    expect(screen.getByTestId('focus-banner')).toBeTruthy();

    // 粘贴另一合法批次：聚焦清除、恢复整日
    fireEvent.change(textarea, {
      target: {
        value: `[
  { "id": "p", "resource": "灯光", "startMs": 0, "endMs": 100 },
  { "id": "q", "resource": "灯光", "startMs": 50, "endMs": 200 }
]`,
      },
    });
    expect(screen.queryByTestId('focus-banner')).toBeNull();
    expect(screen.getByTestId('timeline-inner').getAttribute('data-mode')).toBe('day');
    expect(screen.getByTestId('mode-toggle').textContent).toContain('紧凑时间轴');
    cards = screen.getAllByTestId('conflict-card');
    expect(cards).toHaveLength(1);

    // 再次聚焦后粘贴非法 JSON：整批拒绝，时间轴/工具栏/横幅全部撤下，不沿用旧结果
    fireEvent.click(cards[0]!);
    fireEvent.click(screen.getByTestId('focus-button'));
    expect(screen.getByTestId('focus-banner')).toBeTruthy();
    fireEvent.change(textarea, { target: { value: '[{ broken' } });
    expect(screen.getByTestId('status').textContent).toContain('整批拒绝');
    expect(screen.queryByTestId('timeline-scroll')).toBeNull();
    expect(screen.queryByTestId('focus-banner')).toBeNull();
    expect(screen.queryByTestId('focus-button')).toBeNull();
    expect(screen.queryByTestId('mode-toggle')).toBeNull();
  });

  it('聚焦时载入示例同样清除聚焦并恢复整日', () => {
    render(<App />);
    fireEvent.change(screen.getByLabelText('JSON 数组输入区'), { target: { value: CUES_NEAR_AND_FAR } });
    const cards = screen.getAllByTestId('conflict-card');
    fireEvent.click(cards[0]!);
    fireEvent.click(screen.getByTestId('focus-button'));
    fireEvent.click(screen.getByTestId('mode-toggle'));
    expect(screen.getByTestId('focus-banner')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '载入示例（贴边·安全）' }));
    expect(screen.queryByTestId('focus-banner')).toBeNull();
    expect(screen.getByTestId('timeline-inner').getAttribute('data-mode')).toBe('day');
    // 贴边示例无冲突：列表与交集清空
    expect(screen.getByTestId('all-clear')).toBeTruthy();
    expect(document.querySelectorAll('.overlap')).toHaveLength(0);
  });

  it('再次载入与当前完全相同的示例：text 未变也要退出聚焦并恢复整日', () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: '载入示例（含冲突）' }));
    const cards = screen.getAllByTestId('conflict-card');

    fireEvent.click(cards[0]!);
    fireEvent.click(screen.getByTestId('focus-button'));
    fireEvent.click(screen.getByTestId('mode-toggle'));
    expect(screen.getByTestId('timeline-inner').getAttribute('data-mode')).toBe('compact');
    expect(screen.getByTestId('focus-banner')).toBeTruthy();

    // 再次点同一个“载入示例（含冲突）”：文本字符串与当前相同，
    // 但“载入”本身是明确动作，仍必须清除聚焦、恢复整日
    fireEvent.click(screen.getByRole('button', { name: '载入示例（含冲突）' }));
    expect(screen.queryByTestId('focus-banner')).toBeNull();
    expect(screen.queryByTestId('focus-notice')).toBeNull();
    expect(screen.getByTestId('timeline-inner').getAttribute('data-mode')).toBe('day');
    expect(screen.getByTestId('mode-toggle').textContent).toContain('紧凑时间轴');
    // 重新载入后选中态也清空，示例结果照常呈现（2 处冲突）
    expect(document.querySelectorAll('.conflict-card.active')).toHaveLength(0);
    expect(screen.getAllByTestId('conflict-card')).toHaveLength(2);
  });
});

// 两条跨资源提示在 06:00 前后重叠占用：游标落在 21_600_000（06:00）时两条都在占用；
// 前后均为超过五分钟的长空档，紧凑模式会产生断轴（映射与整日不同）。
const CURSOR_SCENARIO = `[
  { "id": "m", "resource": "灯光-面光L1", "startMs": 21000000, "endMs": 22000000 },
  { "id": "n", "resource": "雾机-上场门", "startMs": 21500000, "endMs": 21800000 }
]`;

// 三项资源：灯光两条重叠（一处争用）、雾机两条重叠（一处争用）、升降台一条（无争用）。
// 资源码点序：升降台-主台(U+5347) < 灯光-面光L1(U+706F) < 雾机-上场门(U+96FE)。
const SCOPE_SCENARIO = `[
  { "id": "LX-01", "resource": "灯光-面光L1", "startMs": 0, "endMs": 120000 },
  { "id": "LX-02", "resource": "灯光-面光L1", "startMs": 60000, "endMs": 180000 },
  { "id": "FOG-01", "resource": "雾机-上场门", "startMs": 90000, "endMs": 150000 },
  { "id": "FOG-02", "resource": "雾机-上场门", "startMs": 120000, "endMs": 200000 },
  { "id": "LIFT-01", "resource": "升降台-主台", "startMs": 30000, "endMs": 210000 }
]`;

function scopeRowButton(resource: string): HTMLElement {
  const el = document.querySelector(`[data-testid="scope-row"][data-resource="${resource}"]`);
  if (!el) throw new Error(`未找到资源行按钮：${resource}`);
  return el as HTMLElement;
}

describe('资源范围隔离', () => {
  it('从时间轴资源名隔离含冲突资源：投影一致、选择保留并联动高亮；切到无争用资源得局部空结果；返回全部资源恢复原排序', () => {
    const { container } = render(<App />);
    fireEvent.change(screen.getByLabelText('JSON 数组输入区'), { target: { value: SCOPE_SCENARIO } });

    // 全场视图：3 行资源、2 处争用，卡片按 resource 码点序（灯光 → 雾机）
    expect(container.querySelectorAll('.tl-row')).toHaveLength(3);
    const cards = screen.getAllByTestId('conflict-card');
    expect(cards).toHaveLength(2);
    const order = () =>
      [...document.querySelectorAll('[data-testid="conflict-resource"]')].map((el) => el.textContent);
    expect(order()).toEqual(['灯光-面光L1', '雾机-上场门']);

    // 先选中灯光的争用，再从时间轴资源名隔离该资源：选择属于新范围 → 原样保留
    fireEvent.click(cards[0]!);
    fireEvent.click(scopeRowButton('灯光-面光L1'));

    // 投影：只剩灯光一行，列表与时间轴消费同一结果（1 卡片 / 1 交集 / 2 提示块）
    expect(screen.getByTestId('scope-banner').textContent).toContain('已隔离：灯光-面光L1');
    expect((screen.getByTestId('scope-select') as HTMLSelectElement).value).toBe('灯光-面光L1');
    expect(container.querySelectorAll('.tl-row')).toHaveLength(1);
    expect(screen.getByTestId('scope-row-current').textContent).toBe('灯光-面光L1');
    expect(screen.getAllByTestId('conflict-card')).toHaveLength(1);
    expect(container.querySelectorAll('.overlap')).toHaveLength(1);
    expect(cueTitles()).toHaveLength(2);

    // 选择保留且联动高亮：双方提示块 hot、交集 active 指向同一争用
    expect(screen.getByTestId('conflict-card').className).toMatch(/active/);
    expect(container.querySelectorAll('.cue-block.hot')).toHaveLength(2);
    expect(container.querySelectorAll('.overlap.active')).toHaveLength(1);

    // 状态条反映范围结论而非整批
    expect(screen.getByTestId('status').textContent).toContain('已隔离资源「灯光-面光L1」');

    // 切换到无争用的升降台：局部空结果——明确“无争用”，绝不宣告整批可执行；
    // 原选中争用不属于新范围 → 同步取消
    fireEvent.change(screen.getByTestId('scope-select'), { target: { value: '升降台-主台' } });
    expect(screen.getByTestId('scope-empty').textContent).toContain('资源「升降台-主台」无争用');
    expect(screen.queryByTestId('all-clear')).toBeNull();
    expect(screen.getByTestId('status').textContent).toContain('无争用');
    expect(screen.getByTestId('status').textContent).not.toContain('可执行');
    expect(screen.queryByTestId('conflict-card')).toBeNull();
    expect(container.querySelectorAll('.overlap')).toHaveLength(0);
    expect(container.querySelectorAll('.conflict-card.active')).toHaveLength(0);
    expect(container.querySelectorAll('.cue-block.hot')).toHaveLength(0);
    // 该资源的提示仍在（局部空的是争用，不是占用）
    expect(cueTitles()).toEqual(['LIFT-01 [00:30.000 → 03:30.000)']);

    // 返回全部资源：3 行恢复，卡片次序与隔离前一致（排序不改写）
    fireEvent.click(screen.getByTestId('scope-clear'));
    expect(screen.queryByTestId('scope-banner')).toBeNull();
    expect((screen.getByTestId('scope-select') as HTMLSelectElement).value).toBe('');
    expect(container.querySelectorAll('.tl-row')).toHaveLength(3);
    expect(order()).toEqual(['灯光-面光L1', '雾机-上场门']);
    expect(container.querySelectorAll('.overlap')).toHaveLength(2);
  });

  it('隔离期间紧凑轴、聚焦与时刻游标按现有规则工作；编辑输入后范围重置', () => {
    const { container } = render(<App />);
    const textarea = screen.getByLabelText('JSON 数组输入区') as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: SCOPE_SCENARIO } });

    // 隔离灯光：选中其争用并进入聚焦（窗口 = 交集 [60000,120000) 两侧各 30 秒）
    fireEvent.click(scopeRowButton('灯光-面光L1'));
    fireEvent.click(screen.getByTestId('conflict-card'));
    fireEvent.click(screen.getByTestId('focus-button'));
    expect(screen.getByTestId('focus-banner').textContent).toContain('00:30.000');
    expect(screen.getByTestId('focus-banner').textContent).toContain('02:30.000');

    // 聚焦期间切紧凑：只重算坐标，范围与窗口不变
    fireEvent.click(screen.getByTestId('mode-toggle'));
    expect(screen.getByTestId('timeline-inner').getAttribute('data-mode')).toBe('compact');
    expect(screen.getByTestId('scope-banner')).toBeTruthy();
    expect(screen.getByTestId('focus-banner')).toBeTruthy();
    expect(container.querySelectorAll('.tl-row')).toHaveLength(1);

    // 时刻游标：隔离视图下占用清单只含范围内资源（90 秒处灯光/雾机/升降台均在占用，
    // 投影后只剩灯光的 LX-01）
    fireEvent.click(mockRulerCanvas(), { clientX: 90 });
    expect(screen.getByTestId('moment-details')).toBeTruthy();
    const groups = screen.getAllByTestId('moment-group');
    expect(groups).toHaveLength(1);
    expect(groups[0]!.textContent).toContain('灯光-面光L1');
    expect(groups[0]!.textContent).toContain('LX-01');

    // 编辑输入：范围恢复全部资源，紧凑/聚焦/游标按现有重置链路一并撤下
    fireEvent.change(textarea, {
      target: {
        value: `[
  { "id": "p", "resource": "灯光", "startMs": 0, "endMs": 100 },
  { "id": "q", "resource": "灯光", "startMs": 50, "endMs": 200 }
]`,
      },
    });
    expect((screen.getByTestId('scope-select') as HTMLSelectElement).value).toBe('');
    expect(screen.queryByTestId('scope-banner')).toBeNull();
    expect(screen.getByTestId('timeline-inner').getAttribute('data-mode')).toBe('day');
    expect(screen.queryByTestId('focus-banner')).toBeNull();
    expect(screen.queryByTestId('moment-details')).toBeNull();
    expect(container.querySelectorAll('.tl-row')).toHaveLength(1);
  });

  it('载入示例与非法输入同样恢复全部资源范围', () => {
    const { container } = render(<App />);
    const textarea = screen.getByLabelText('JSON 数组输入区') as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: SCOPE_SCENARIO } });
    fireEvent.click(scopeRowButton('雾机-上场门'));
    expect(screen.getByTestId('scope-banner')).toBeTruthy();

    // 载入示例：范围重置为全部资源（示例含 3 项资源）
    fireEvent.click(screen.getByRole('button', { name: '载入示例（含冲突）' }));
    expect((screen.getByTestId('scope-select') as HTMLSelectElement).value).toBe('');
    expect(screen.queryByTestId('scope-banner')).toBeNull();
    expect(container.querySelectorAll('.tl-row')).toHaveLength(3);

    // 再次隔离后粘贴非法输入：整批拒绝，范围状态一并撤下
    fireEvent.click(scopeRowButton('灯光-面光L1'));
    expect(screen.getByTestId('scope-banner')).toBeTruthy();
    fireEvent.change(textarea, { target: { value: '[{ broken' } });
    expect(screen.getByTestId('status').textContent).toContain('整批拒绝');
    expect(screen.queryByTestId('scope-select')).toBeNull();
    expect(screen.queryByTestId('scope-banner')).toBeNull();

    // 修正后：范围仍是全部资源，不残留隔离视图
    fireEvent.change(textarea, { target: { value: SCOPE_SCENARIO } });
    expect((screen.getByTestId('scope-select') as HTMLSelectElement).value).toBe('');
    expect(container.querySelectorAll('.tl-row')).toHaveLength(3);
  });
});

describe('时刻游标：设置 / 移动 / 清除', () => {

  it('点击刻度带设置游标并显示占用分组；再点移动；无占用时刻提示且标线保留；清除后撤下', () => {
    render(<App />);
    fireEvent.change(screen.getByLabelText('JSON 数组输入区'), { target: { value: CURSOR_SCENARIO } });

    // 点击刻度带 06:00 处（clientX 21600 × 1000ms）：设置游标
    fireEvent.click(mockRulerCanvas(), { clientX: 21_600 });
    expect(screen.getByTestId('moment-label').textContent).toBe('时刻 360:00.000');
    // 该时刻两条提示都在占用，按 resource 码点序分组：灯光（U+706F）在雾机（U+96FE）前
    const groups = screen.getAllByTestId('moment-group');
    expect(groups).toHaveLength(2);
    expect(groups[0]!.textContent).toContain('灯光-面光L1');
    expect(groups[0]!.textContent).toContain('m');
    expect(groups[1]!.textContent).toContain('雾机-上场门');
    expect(groups[1]!.textContent).toContain('n');
    // 标线贯穿刻度带与两条资源行，均指向同一真实时刻
    expect(cursorLineMoments()).toEqual(['21600000', '21600000', '21600000']);

    // 点击别处（移动到 01:40.000：该时刻无任何占用
    fireEvent.click(mockRulerCanvas(), { clientX: 100 });
    expect(screen.getByTestId('moment-label').textContent).toBe('时刻 01:40.000');
    expect(screen.getByTestId('moment-empty').textContent).toBe('此刻无设备占用');
    expect(screen.queryAllByTestId('moment-group')).toHaveLength(0);
    // 标线保留，仍指向新时刻
    expect(cursorLineMoments()).toEqual(['100000', '100000', '100000']);

    // 清除游标：详情与标线一起撤下
    fireEvent.click(screen.getByTestId('cursor-clear'));
    expect(screen.queryByTestId('moment-details')).toBeNull();
    expect(document.querySelectorAll('.cursor-line')).toHaveLength(0);
  });

  it('切换显示模式后标线与详情仍指向同一真实时刻', () => {
    render(<App />);
    fireEvent.change(screen.getByLabelText('JSON 数组输入区'), { target: { value: CURSOR_SCENARIO } });
    fireEvent.click(mockRulerCanvas(), { clientX: 21_600 });
    expect(screen.getByTestId('moment-label').textContent).toBe('时刻 360:00.000');

    // 整日 → 紧凑：只重算坐标，游标真实时刻与占用清单不变
    fireEvent.click(screen.getByTestId('mode-toggle'));
    expect(screen.getByTestId('timeline-inner').getAttribute('data-mode')).toBe('compact');
    expect(screen.getByTestId('moment-label').textContent).toBe('时刻 360:00.000');
    expect(cursorLineMoments()).toEqual(['21600000', '21600000', '21600000']);
    expect(screen.getAllByTestId('moment-group')).toHaveLength(2);

    // 紧凑 → 整日：同样不变
    fireEvent.click(screen.getByTestId('mode-toggle'));
    expect(screen.getByTestId('timeline-inner').getAttribute('data-mode')).toBe('day');
    expect(screen.getByTestId('moment-label').textContent).toBe('时刻 360:00.000');
    expect(cursorLineMoments()).toEqual(['21600000', '21600000', '21600000']);
  });

  it('游标落在聚焦窗口内则保留；落在窗口外则提示“游标已移出当前窗口”并清除', () => {
    render(<App />);
    fireEvent.change(screen.getByLabelText('JSON 数组输入区'), { target: { value: CUES_NEAR_AND_FAR } });

    // 游标设在 10:30.000（630_000ms），落在锚争用 (a,b) 的聚焦窗口 [600000,690000) 内
    fireEvent.click(mockRulerCanvas(), { clientX: 630 });
    expect(screen.getByTestId('moment-label').textContent).toBe('时刻 10:30.000');
    // 该时刻 a、b 均在占用（b 恰在 startMs 已计入）
    expect(screen.getAllByTestId('moment-group')).toHaveLength(1);
    expect(screen.getByTestId('moment-group').textContent).toContain('a');
    expect(screen.getByTestId('moment-group').textContent).toContain('b');

    // 选中锚争用并进入聚焦：游标在窗口内 → 原样保留，无提示
    const cards = screen.getAllByTestId('conflict-card');
    fireEvent.click(cards[0]!);
    fireEvent.click(screen.getByTestId('focus-button'));
    expect(screen.getByTestId('focus-banner')).toBeTruthy();
    expect(screen.queryByTestId('focus-notice')).toBeNull();
    expect(screen.getByTestId('moment-label').textContent).toBe('时刻 10:30.000');
    // 标线随窗口映射重算坐标，真实时刻不变
    expect(cursorLineMoments().every((m) => m === '630000')).toBe(true);

    // 退出聚焦（游标保留），把游标移到窗口外的 16:40.000（1_000_000ms）
    fireEvent.click(screen.getByTestId('exit-focus'));
    fireEvent.click(mockRulerCanvas(), { clientX: 1_000 });
    expect(screen.getByTestId('moment-label').textContent).toBe('时刻 16:40.000');

    // 再次从同一聚焦入口进入：游标落在窗口外 → 就近反馈并清除游标
    fireEvent.click(screen.getByTestId('focus-button'));
    const notice = screen.getByTestId('focus-notice');
    expect(notice.textContent).toContain('游标已移出当前窗口');
    expect(notice.textContent).toContain('已清除游标');
    expect(screen.queryByTestId('moment-details')).toBeNull();
    expect(document.querySelectorAll('.cursor-line')).toHaveLength(0);
    // 聚焦本身照常进入，选中项保留
    expect(screen.getByTestId('focus-banner')).toBeTruthy();
    expect(cards[0]!.className).toMatch(/active/);
  });

  it('聚焦后点击刻度带右端：游标夹回半开窗口内，不落到窗外终点', () => {
    render(<App />);
    fireEvent.change(screen.getByLabelText('JSON 数组输入区'), { target: { value: CUES_NEAR_AND_FAR } });

    const cards = screen.getAllByTestId('conflict-card');
    fireEvent.click(cards[0]!);
    fireEvent.click(screen.getByTestId('focus-button'));
    // 锚 (a,b) 窗口 [600000,690000)（半开，终点 690000 不属于窗口）
    expect(screen.getByTestId('focus-banner')).toBeTruthy();

    // 点击刻度带最右端：窗口映射反演本会得到窗外终点 690000（11:30.000），
    // 正确状态应夹回窗口内最后一毫秒 689999（11:29.999）
    fireEvent.click(mockRulerCanvas(), { clientX: 86_400 });
    expect(screen.getByTestId('moment-label').textContent).toBe('时刻 11:29.999');
    expect(cursorLineMoments().every((m) => m === '689999')).toBe(true);
    expect(screen.queryByTestId('focus-notice')).toBeNull();
  });

  it('窗外清除提示后窗口内重设游标：只呈现有效游标，旧提示不并存；手动清除后提示同步撤下', () => {
    render(<App />);
    fireEvent.change(screen.getByLabelText('JSON 数组输入区'), { target: { value: CUES_NEAR_AND_FAR } });

    // 先把游标放到窗口外（16:40.000），进入聚焦 → 游标被清除并给出移出窗口提示
    fireEvent.click(mockRulerCanvas(), { clientX: 1_000 });
    const cards = screen.getAllByTestId('conflict-card');
    fireEvent.click(cards[0]!);
    fireEvent.click(screen.getByTestId('focus-button'));
    const staleNotice = screen.getByTestId('focus-notice');
    expect(staleNotice.textContent).toContain('游标已移出当前窗口');
    expect(screen.queryByTestId('moment-details')).toBeNull();

    // 在窗口内重新设置有效游标（窗口映射下 clientX=630 → 约 600656ms，落在提示 a 内）：
    // 当前详情与旧清除提示不得同时出现——只呈现有效游标
    fireEvent.click(mockRulerCanvas(), { clientX: 630 });
    expect(screen.getByTestId('moment-details')).toBeTruthy();
    expect(screen.queryByTestId('focus-notice')).toBeNull();
    expect(screen.getByTestId('moment-group').textContent).toContain('a');
    expect(cursorLineMoments().length).toBeGreaterThan(0);

    // 从详情区手动清除：标线与详情消失，旧移出窗口提示也不得残留
    fireEvent.click(screen.getByTestId('cursor-clear'));
    expect(screen.queryByTestId('moment-details')).toBeNull();
    expect(document.querySelectorAll('.cursor-line')).toHaveLength(0);
    expect(screen.queryByTestId('focus-notice')).toBeNull();
  });

  it('编辑 / 粘贴 / 载入示例 / 非法输入按现有重置链路撤下游标', () => {
    render(<App />);
    const textarea = screen.getByLabelText('JSON 数组输入区') as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: CURSOR_SCENARIO } });
    fireEvent.click(mockRulerCanvas(), { clientX: 21_600 });
    expect(screen.getByTestId('moment-details')).toBeTruthy();

    // 编辑为另一合法批次：游标撤下
    fireEvent.change(textarea, {
      target: { value: `[{ "id": "p", "resource": "灯光", "startMs": 0, "endMs": 100 }]` },
    });
    expect(screen.queryByTestId('moment-details')).toBeNull();
    expect(document.querySelectorAll('.cursor-line')).toHaveLength(0);

    // 重新设置后载入示例：游标撤下
    fireEvent.click(mockRulerCanvas(), { clientX: 50 });
    expect(screen.getByTestId('moment-details')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '载入示例（含冲突）' }));
    expect(screen.queryByTestId('moment-details')).toBeNull();
    expect(document.querySelectorAll('.cursor-line')).toHaveLength(0);

    // 再次设置后粘贴非法输入：整批拒绝，游标随重置链路撤下
    fireEvent.click(mockRulerCanvas(), { clientX: 60 });
    expect(screen.getByTestId('moment-details')).toBeTruthy();
    fireEvent.change(textarea, { target: { value: '[{ broken' } });
    expect(screen.getByTestId('status').textContent).toContain('整批拒绝');
    expect(screen.queryByTestId('moment-details')).toBeNull();
    expect(document.querySelectorAll('.cursor-line')).toHaveLength(0);
  });
});
