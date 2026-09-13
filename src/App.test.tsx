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
