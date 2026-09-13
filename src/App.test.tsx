import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import App from './App';
import { SAMPLE_CONFLICT } from './samples';

/**
 * 聚焦上下文的 React 交互测试（jsdom）：
 * 领域投影由 focusWindow / compactScale 的纯函数测试保证，这里只验证装配行为——
 * 窗口内呈现、切模式只重算坐标、完全重叠争用逐组轮换、选择失效就近反馈并退焦、
 * 编辑/粘贴/载入示例清除聚焦。
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
});
