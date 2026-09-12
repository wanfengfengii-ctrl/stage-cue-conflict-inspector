# 舞台设备资源冲突检视器

灯光、升降台、雾机等各部门的提示（cue）由多人分别编排，单看每张表都合理，
合并后却可能在**同一台设备**上出现危险的时间重叠。本工具是一个**纯前端**
React 检视器：舞台监督把合并后的提示粘贴为 JSON 数组，立即完成资源冲突检视，
并按资源绘制可滚动时间轴；选择冲突时，争用双方与交集时间段同步高亮。

- React 18 + TypeScript + Vite 6
- 单元测试：Vitest
- 端到端测试：Playwright（Chromium）
- 无后端、无网络请求：所有解析与检测均在浏览器本地完成

## 输入约定

输入必须是一个 **JSON 数组**，至少包含一条；每个元素是对象，字段如下：

| 字段      | 类型     | 要求                                                                 |
| --------- | -------- | -------------------------------------------------------------------- |
| `id`      | `string` | 非空，且在整批输入中**唯一**                                         |
| `resource`| `string` | 非空，设备资源名；只有同名资源之间才会检测冲突                       |
| `startMs` | `number` | 整数毫秒，`0 ≤ startMs ≤ 86400000`（一天）                           |
| `endMs`   | `number` | 整数毫秒，`0 ≤ endMs ≤ 86400000`，且 `startMs < endMs`               |

示例：

```json
[
  { "id": "LX-01", "resource": "灯光-面光L1", "startMs": 0, "endMs": 120000 },
  { "id": "LX-02", "resource": "灯光-面光L1", "startMs": 60000, "endMs": 180000 },
  { "id": "FOG-01", "resource": "雾机-上场门", "startMs": 90000, "endMs": 150000 }
]
```

### 冲突判定规则

- 区间一律采用**半开区间 `[startMs, endMs)`**：提示在 `startMs` 时刻开始占用，
  在 `endMs` 时刻释放。
- 仅当两项的 `resource` 相同，**且交集长度严格大于 0** 时构成冲突：
  - 重叠起点 = `max(startA, startB)`
  - 重叠终点 = `min(endA, endB)`
  - 时长 = `重叠终点 − 重叠起点`，必须 `> 0`
- 因此一条的 `endMs` 恰好等于另一条的 `startMs`（贴边交接）**不会被误报**；
  交集哪怕只有 **1ms** 也会被逐毫秒定位出来。
- 不同 `resource` 的提示即使时间段完全重合也不冲突。

### 输出与排序

每一对冲突只输出一次，给出：双方 `id`（按 Unicode 码点顺序分为较小/较大）、
重叠起点、重叠终点、重叠时长（毫秒）。列表按以下键排序：

1. `resource`（Unicode 码点顺序）
2. 重叠起点 `overlapStart`
3. 较小的 id（Unicode 码点顺序）
4. 较大的 id（Unicode 码点顺序）

排序基于码点（code point）而非本地语言排序或 UTF-16 码元，emoji 等
增补平面字符的次序也确定可复现。

### 整批拒绝

出现以下任一情况时，**整批输入被拒绝**，页面在对应条目附近（第 N 条 / 行号，
点击问题徽章可选中该条原文）给出原因，并且**不会保留或沿用任何旧结果**：

- 输入不是 JSON 数组、JSON 语法错误、或数组为空；
- 任一条目缺少字段、字段类型不符、时间超出 `0..86400000`、非整数、
  或 `startMs ≥ endMs`；
- `id` 为空字符串或在批内重复。

## 本地开发

```bash
npm install
npm run dev        # 启动 Vite 开发服务器（默认 http://localhost:5173）
npm run build      # 类型检查 + 生产构建到 dist/
npm run preview    # 本地预览生产构建
```

## 测试

```bash
npm run test       # Vitest 单元测试（校验、冲突检测、码点排序、JSON 定位）
npx playwright install chromium   # 首次运行端到端测试前安装浏览器
npm run e2e        # Playwright 端到端（自动起 dev server）
npm run acceptance # 完整本地验收：build + Vitest + Playwright
```

## Docker 发布与验收

```bash
# 构建并发布（默认宿主机端口 8080）
docker compose up --build
# 自定义发布端口：
WEB_PORT=9000 docker compose up --build
```

`WEB_PORT` 仅改变宿主机发布端口（容器内固定监听 8080），例如
`WEB_PORT=9000` 后访问 http://localhost:9000 。

一次性验收服务 `verify` 会在容器内执行 **生产构建 → Vitest → Playwright**，
全部通过则退出码为 0：

```bash
docker compose build verify
docker compose run --rm verify
```

## 目录结构

```
src/
  core/            # 纯逻辑：类型、校验、冲突检测、格式化、JSON 文本定位（含单测）
  components/      # InputPanel / Timeline / ConflictList
  App.tsx          # 粘贴即检测；非法输入整批拒绝、不沿用旧结果
e2e/               # Playwright 端到端测试
Dockerfile         # web（静态发布）与 verify（一次性验收）两个目标
docker-compose.yml # web（WEB_PORT 可覆盖）+ verify
```
