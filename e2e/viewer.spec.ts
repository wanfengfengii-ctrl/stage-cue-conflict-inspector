import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
});

test('初始状态等待输入，无旧结果', async ({ page }) => {
  await expect(page.getByTestId('status')).toContainText('等待输入');
  await expect(page.getByTestId('all-clear')).toHaveCount(0);
});

test('含冲突的示例：列出冲突，点击后双方与交集同步高亮，再点取消', async ({ page }) => {
  await page.getByRole('button', { name: '载入示例（含冲突）' }).click();

  await expect(page.getByTestId('status')).toContainText('发现 2 处设备争用');
  const cards = page.getByTestId('conflict-card');
  await expect(cards).toHaveCount(2);

  // 排序校验：灯光（码点 U+706F）排在雾机（U+96FE）之前
  await expect(cards.first().getByTestId('conflict-resource')).toHaveText('灯光-面光L1');
  await expect(cards.nth(1).getByTestId('conflict-resource')).toHaveText('雾机-上场门');

  // 第一张卡片：LX-01 ⨯ LX-02，重叠 60000..120000，时长 60000ms
  const first = cards.first();
  await expect(first).toContainText('LX-01');
  await expect(first).toContainText('LX-02');
  await expect(first).toContainText('时长 60000ms');

  await first.click();
  await expect(first).toHaveClass(/active/);

  // 时间轴上双方提示块高亮，其余压暗；交集块高亮
  await expect(page.locator('.cue-block.hot')).toHaveCount(2);
  await expect(page.locator('.overlap.active')).toHaveCount(1);

  const hotTitles = await page.locator('.cue-block.hot').evaluateAll((nodes) =>
    nodes.map((n) => (n as HTMLElement).title),
  );
  expect(hotTitles.some((t) => t.startsWith('LX-01'))).toBe(true);
  expect(hotTitles.some((t) => t.startsWith('LX-02'))).toBe(true);

  // 点击时间轴上的交集同样切换
  await page.locator('.overlap.active').click();
  await expect(first).not.toHaveClass(/active/);
  await expect(page.locator('.cue-block.hot')).toHaveCount(0);
});

test('贴边交接（endMs === startMs）明确显示可执行，不误报', async ({ page }) => {
  await page.getByRole('button', { name: '载入示例（贴边·安全）' }).click();
  await expect(page.getByTestId('all-clear')).toBeVisible();
  await expect(page.getByTestId('all-clear')).toContainText('可执行');
  await expect(page.getByTestId('conflict-card')).toHaveCount(0);
  await expect(page.locator('.overlap')).toHaveCount(0);
});

test('非法字段整批拒绝：就近反馈且不沿用旧结果，修正后恢复', async ({ page }) => {
  // 先得到一份合法结果
  await page.getByRole('button', { name: '载入示例（贴边·安全）' }).click();
  await expect(page.getByTestId('all-clear')).toBeVisible();

  // 粘贴重复 id 且 startMs 非法的批次
  await page.locator('.json-input').fill(`[
  { "id": "x", "resource": "灯光", "startMs": 0, "endMs": 100 },
  { "id": "x", "resource": "灯光", "startMs": 5, "endMs": 4 }
]`);

  await expect(page.getByTestId('status')).toContainText('整批拒绝');
  const alert = page.getByRole('alert', { name: '校验问题' });
  await expect(alert).toContainText('id "x" 重复');
  await expect(alert).toContainText('严格小于');
  await expect(alert).toContainText('第 2 条');

  // 旧的“可执行”结果已不存在，时间轴也不渲染
  await expect(page.getByTestId('all-clear')).toHaveCount(0);
  await expect(page.locator('.tl-row')).toHaveCount(0);

  // 点击问题徽章可选中输入框中对应条目原文
  await page.getByRole('button', { name: /第 2 条/ }).first().click();
  const selected = await page.evaluate(() => {
    const ta = document.querySelector('.json-input') as HTMLTextAreaElement;
    return ta.value.slice(ta.selectionStart, ta.selectionEnd);
  });
  expect(selected).toContain('"id": "x"');

  // 修正为不重叠的合法批次后恢复，且不残留错误
  await page.locator('.json-input').fill(`[
  { "id": "x", "resource": "灯光", "startMs": 0, "endMs": 100 },
  { "id": "y", "resource": "灯光", "startMs": 100, "endMs": 200 }
]`);
  await expect(page.getByTestId('all-clear')).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('JSON 语法错误与空数组在顶层反馈', async ({ page }) => {
  await page.locator('.json-input').fill('[{ broken');
  await expect(page.getByRole('alert').first()).toContainText('JSON 语法错误');

  await page.locator('.json-input').fill('[]');
  const alert = page.getByRole('alert', { name: '校验问题' });
  await expect(alert).toContainText('数组为空');
});

test('1ms 的真实争用可被定位，输出双方 id 与重叠起止/时长', async ({ page }) => {
  await page.locator('.json-input').fill(`[
  { "id": "a", "resource": "雾机", "startMs": 1000, "endMs": 2001 },
  { "id": "b", "resource": "雾机", "startMs": 2000, "endMs": 3000 }
]`);
  const card = page.getByTestId('conflict-card');
  await expect(card).toHaveCount(1);
  await expect(card).toContainText('a');
  await expect(card).toContainText('b');
  await expect(card).toContainText('时长 1ms');
});

test.describe('紧凑时间轴', () => {
  // 1ms 争用位于 01:00:00.999~01:00:01.000：整日模式下仅约万分之一像素无法点中；
  // 紧凑模式把一小时日首长空档压成 30 秒显示宽后，交集恰为 1px，可逐毫秒点中。
  const ONE_MS_AT_ONE_HOUR = `[
  { "id": "early-a", "resource": "雾机-上场门", "startMs": 3600000, "endMs": 3601000 },
  { "id": "early-b", "resource": "雾机-上场门", "startMs": 3600999, "endMs": 3602000 }
]`;

  test('切换紧凑模式：出现断轴标记并标注空档真实起止，刻度仍为真实时刻', async ({ page }) => {
    await page.locator('.json-input').fill(ONE_MS_AT_ONE_HOUR);

    const toggle = page.getByTestId('mode-toggle');
    const inner = page.getByTestId('timeline-inner');

    await expect(inner).toHaveAttribute('data-mode', 'day');
    await expect(toggle).toContainText('紧凑时间轴');

    await toggle.click();

    await expect(inner).toHaveAttribute('data-mode', 'compact');
    await expect(toggle).toContainText('返回整日时间轴');
    await expect(page.getByTestId('mode-hint')).toBeVisible();

    // 日首空档 00:00.000 → 01:00.000 被压缩；断轴出现在刻度带与资源行
    const breaks = page.getByTestId('axis-break');
    await expect(breaks.first()).toBeVisible();
    await expect(breaks.first()).toHaveAttribute('data-real-start', '0');
    await expect(breaks.first()).toHaveAttribute('data-real-end', '3600000');
    await expect(breaks.first()).toHaveAttribute('title', /空档 00:00\.000 至 60:00\.000/);

    // 压缩固定为三十秒显示宽：映射比例 30000/62000 ≈ 48.4% 落在可见轨道内，
    // 整体随轨道等比缩放，不再是 30000 物理像素（无需横向滚动数十屏）
    const dims = await breaks.first().evaluate((el) => {
      const canvas = el.closest('.tl-track') ?? el.parentElement!;
      return {
        marker: el.getBoundingClientRect().width,
        canvas: canvas.getBoundingClientRect().width,
      };
    });
    expect(dims.marker / dims.canvas).toBeCloseTo(30_000 / 62_000, 1);
    expect(dims.marker).toBeLessThan(1000);

    // 整体等比缩放铺满面板：紧凑时间轴不得出现横向滚动，提示块也不再是数万像素
    const overflow = await page.getByTestId('timeline-scroll').evaluate((el) => ({
      scrollWidth: el.scrollWidth,
      clientWidth: el.clientWidth,
    }));
    expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth + 1);

    const cueWidths = await page.locator('.cue-block').evaluateAll((nodes) =>
      nodes.map((n) => n.getBoundingClientRect().width),
    );
    for (const w of cueWidths) expect(w).toBeLessThan(1000);

    // 刻度上仍能读到真实时刻 60:00.000（占用片段起点），而不是被压缩后的伪时刻
    await expect(page.locator('.timeline-ruler')).toContainText('60:00.000');
  });

  test('点击压缩后的 1ms 交集：列表卡片与时间轴高亮始终指向同一争用', async ({ page }) => {
    await page.locator('.json-input').fill(ONE_MS_AT_ONE_HOUR);
    await page.getByTestId('mode-toggle').click();

    const overlap = page.locator('.overlap');
    await expect(overlap).toHaveCount(1);

    // 整体随轨道等比缩放后，1ms 交集物理宽度不足 1px；
    // 紧凑模式为其提供 6px 最小点击热区（位置仍精确取自映射），因此可逐毫秒点中
    const box = await overlap.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.width).toBeGreaterThanOrEqual(5.5);
    expect(box!.width).toBeLessThan(8);
    await overlap.click();

    // 时间轴交集高亮，且唯一一张冲突卡片同步激活（同一争用）
    await expect(overlap).toHaveClass(/active/);
    const card = page.getByTestId('conflict-card');
    await expect(card).toHaveClass(/active/);
    await expect(card).toContainText('时长 1ms');
    await expect(page.locator('.cue-block.hot')).toHaveCount(2);

    // 再点交集取消，两边同时取消
    await overlap.click();
    await expect(overlap).not.toHaveClass(/active/);
    await expect(card).not.toHaveClass(/active/);

    // 反向联动：从列表点选后时间轴高亮同一争用
    await card.click();
    await expect(overlap).toHaveClass(/active/);
    await expect(card).toHaveClass(/active/);
  });

  test('返回整日时间轴后保留仍有效的冲突选择，且断轴消失', async ({ page }) => {
    await page.locator('.json-input').fill(ONE_MS_AT_ONE_HOUR);
    await page.getByTestId('mode-toggle').click();

    await page.locator('.overlap').click();
    await expect(page.getByTestId('conflict-card')).toHaveClass(/active/);

    await page.getByTestId('mode-toggle').click();

    await expect(page.getByTestId('timeline-inner')).toHaveAttribute('data-mode', 'day');
    await expect(page.getByTestId('mode-toggle')).toContainText('紧凑时间轴');
    await expect(page.getByTestId('axis-break')).toHaveCount(0);

    // 选择原样保留：卡片与时间轴交集仍指向同一争用
    await expect(page.getByTestId('conflict-card')).toHaveClass(/active/);
    await expect(page.locator('.overlap.active')).toHaveCount(1);
  });

  test('编辑 JSON 自动恢复整日模式；非法输入在紧凑模式下同样撤下列表与时间轴', async ({ page }) => {
    await page.locator('.json-input').fill(ONE_MS_AT_ONE_HOUR);
    await page.getByTestId('mode-toggle').click();
    await expect(page.getByTestId('timeline-inner')).toHaveAttribute('data-mode', 'compact');

    // 输入新的合法批次：恢复整日
    await page.locator('.json-input').fill(`[
  { "id": "a", "resource": "灯光", "startMs": 0, "endMs": 100 },
  { "id": "b", "resource": "灯光", "startMs": 50, "endMs": 200 }
]`);
    await expect(page.getByTestId('timeline-inner')).toHaveAttribute('data-mode', 'day');
    await expect(page.getByTestId('mode-toggle')).toContainText('紧凑时间轴');

    // 再进紧凑，随后改成非法批次：整批拒绝，时间轴/切换开关/列表全部撤下
    await page.getByTestId('mode-toggle').click();
    await expect(page.getByTestId('timeline-inner')).toHaveAttribute('data-mode', 'compact');
    await page.locator('.json-input').fill('[{ broken');
    await expect(page.getByTestId('status')).toContainText('整批拒绝');
    await expect(page.getByTestId('timeline-scroll')).toHaveCount(0);
    await expect(page.getByTestId('mode-toggle')).toHaveCount(0);
    await expect(page.getByTestId('conflict-card')).toHaveCount(0);

    // 修正后重新渲染，模式已重置为整日
    await page.locator('.json-input').fill(`[
  { "id": "a", "resource": "灯光", "startMs": 0, "endMs": 100 },
  { "id": "b", "resource": "灯光", "startMs": 50, "endMs": 200 }
]`);
    await expect(page.getByTestId('timeline-inner')).toHaveAttribute('data-mode', 'day');
    await expect(page.getByTestId('conflict-card')).toHaveCount(1);
  });

  test('紧凑模式不改写冲突排序：多资源示例的卡片次序与整日后一致', async ({ page }) => {
    await page.getByRole('button', { name: '载入示例（含冲突）' }).click();
    const order = () =>
      page
        .getByTestId('conflict-card')
        .locator('[data-testid="conflict-resource"]')
        .allTextContents();

    expect(await order()).toEqual(['灯光-面光L1', '雾机-上场门']);

    await page.getByTestId('mode-toggle').click();
    await expect(page.getByTestId('timeline-inner')).toHaveAttribute('data-mode', 'compact');
    expect(await order()).toEqual(['灯光-面光L1', '雾机-上场门']);
    await expect(page.getByTestId('conflict-card')).toHaveCount(2);
    await expect(page.getByTestId('axis-break')).not.toHaveCount(0);
  });
});

test.describe('交集热区选择：完全重叠 / 紧凑轴相邻 1ms / 空字符身份', () => {
  test('同一设备三组争用完全重叠：同一点可逐组选择核对，每次仅一组高亮', async ({ page }) => {
    // 三条提示完全重叠 → 三对争用（a,b）（a,c）（b,c），交集完全相同，
    // 三个交集标记叠在同一个点击区域。
    await page.locator('.json-input').fill(`[
  { "id": "a", "resource": "灯杆-1", "startMs": 0, "endMs": 86400000 },
  { "id": "b", "resource": "灯杆-1", "startMs": 0, "endMs": 86400000 },
  { "id": "c", "resource": "灯杆-1", "startMs": 0, "endMs": 86400000 }
]`);

    const cards = page.getByTestId('conflict-card');
    await expect(cards).toHaveCount(3);
    const overlaps = page.locator('.overlap');
    await expect(overlaps).toHaveCount(3);

    // 三个标记几何完全一致，始终点同一位置。浏览器只会把该点的点击交给最上层
    // 按钮（旧实现因此永远只能选中最后一组）；force 绕过 Playwright 的遮挡检查，
    // 模拟用户在这一点上的真实点击，归属改由坐标解析后即可逐组轮换。
    const clickStack = () => overlaps.nth(0).click({ force: true });

    await clickStack();
    await expect(cards.nth(0)).toHaveClass(/active/);
    await expect(page.locator('.overlap.active')).toHaveCount(1);

    await clickStack();
    await expect(cards.nth(0)).not.toHaveClass(/active/);
    await expect(cards.nth(1)).toHaveClass(/active/);
    await expect(page.locator('.overlap.active')).toHaveCount(1);

    await clickStack();
    await expect(cards.nth(1)).not.toHaveClass(/active/);
    await expect(cards.nth(2)).toHaveClass(/active/);
    await expect(page.locator('.overlap.active')).toHaveCount(1);

    // 最后一组之后再点回到未选中，三组都能被逐组核对
    await clickStack();
    await expect(page.locator('.conflict-card.active')).toHaveCount(0);
    await expect(page.locator('.overlap.active')).toHaveCount(0);
  });

  test('紧凑轴两处相邻 1ms 争用：扩展热区互相覆盖时点击归属与指向的交集一致', async ({ page }) => {
    // a[3600000,3601000) b[3600999,3601001) c[3601000,3602000)
    // 争用1=(a,b) 交集 [3600999,3601000)；争用2=(b,c) 交集 [3601000,3601001)；
    // a 与 c 贴边不冲突。两处 1ms 争用仅相距 1ms，6px 最小热区几乎完全重合。
    await page.locator('.json-input').fill(`[
  { "id": "a", "resource": "雾机", "startMs": 3600000, "endMs": 3601000 },
  { "id": "b", "resource": "雾机", "startMs": 3600999, "endMs": 3601001 },
  { "id": "c", "resource": "雾机", "startMs": 3601000, "endMs": 3602000 }
]`);
    await page.getByTestId('mode-toggle').click();

    const cards = page.getByTestId('conflict-card');
    await expect(cards).toHaveCount(2);
    const first = page.locator('.overlap').nth(0);
    const second = page.locator('.overlap').nth(1);

    // 点前一个标记的中心：它与后一个标记的 6px 热区重叠，浏览器会把点击交给
    // DOM 更上层的后者（旧实现因此误选后一处）。force 绕过遮挡检查，归属按坐标解析。
    await first.click({ force: true });
    await expect(cards.nth(0)).toHaveClass(/active/);
    await expect(cards.nth(1)).not.toHaveClass(/active/);
    await expect(page.locator('.overlap.active')).toHaveCount(1);

    // 点后一个标记的中心则选中后一个
    await second.click({ force: true });
    await expect(cards.nth(0)).not.toHaveClass(/active/);
    await expect(cards.nth(1)).toHaveClass(/active/);
    await expect(page.locator('.overlap.active')).toHaveCount(1);
  });

  test('资源名/编号含合法空字符(U+0000)：选择一条争用只高亮该争用，不与撞键的另一条联动', async ({ page }) => {
    // 旧选择键的字段分隔符本身就是 NUL；JSON 转义 u0000 是合法字符串内容，
    // 因而 ("a","x<NUL>y") 与 ("a<NUL>x","y") 两对不同争用得到完全相同的键，
    // 旧实现点击其中一条会同时高亮两条（两张卡片、两个交集）。
    await page.locator('.json-input').fill(`[
  { "id": "a", "resource": "r", "startMs": 0, "endMs": 200 },
  { "id": "x\\u0000y", "resource": "r", "startMs": 0, "endMs": 200 },
  { "id": "a\\u0000x", "resource": "r", "startMs": 0, "endMs": 200 },
  { "id": "y", "resource": "r", "startMs": 0, "endMs": 200 }
]`);

    await expect(page.getByTestId('conflict-card')).toHaveCount(6);

    // NUL 无法走常规文本定位器：在页面内按 code 精确匹配后用 DOM 点击
    // 选中 a ⨯ x<NUL>y 这一张
    const clickResult = await page.evaluate(() => {
      const cards = [...document.querySelectorAll('.conflict-card')] as HTMLButtonElement[];
      const card = cards.find((el) => {
        const codes = [...el.querySelectorAll('code')].map((c) => c.textContent ?? '');
        return codes.includes('a') && codes.includes('x\u0000y');
      });
      if (!card) return 'not-found';
      card.click();
      return 'clicked';
    });
    expect(clickResult).toBe('clicked');

    // 只有一张卡片、一个交集激活（旧实现为 2/2）
    await expect(page.locator('.conflict-card.active')).toHaveCount(1);
    await expect(page.locator('.overlap.active')).toHaveCount(1);

    // 激活的交集正是所点击的 a ⨯ x<NUL>y（用 JSON 比较以显式承载 NUL）
    const activeLabel = await page
      .locator('.overlap.active')
      .evaluate((el) => JSON.stringify(el.getAttribute('aria-label')));
    expect(activeLabel).toBe(JSON.stringify('冲突：a 与 x\u0000y，重叠 200 毫秒'));
  });
});
