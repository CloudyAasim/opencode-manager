# 测试指南

本项目有三层测试，各自负责不同的失败模式。修改代码后按从快到慢的顺序跑。

## 快速参考

```bash
# 前端单元 / 组件测试（vitest，秒级）
pnpm --filter frontend exec vitest run

# 前端渲染冒烟（构建产物 + 无头 Chromium，约 10 秒）
pnpm --filter frontend build
pnpm --filter frontend smoke:render

# 端到端测试（构建产物 + 真实浏览器 + 路由 mock）
pnpm --filter frontend test:e2e
pnpm --filter frontend test:e2e:desktop   # 仅桌面
pnpm --filter frontend test:e2e:ui        # 带 UI 调试

# 后端
pnpm --filter backend test

# 全部
pnpm test
pnpm typecheck
pnpm lint
```

## 三层测试的分工

| 层 | 命令 | 抓什么 | 抓不到什么 |
|---|---|---|---|
| 单元 / 组件 | `vitest run` | 函数逻辑、hook 行为、组件渲染（jsdom） | 真实浏览器行为、构建产物问题、跨模块时序 |
| 渲染冒烟 | `smoke:render` | 构建产物能否在真实浏览器挂载（`#root` 非空）、资源 404、未捕获异常 | 交互流程、路由跳转 |
| 端到端 | `test:e2e` | 路由跳转、拖拽、键盘操作、响应式布局、**时序竞态** | 极细粒度的单位逻辑 |

**为什么需要端到端这一层**：本项目曾出现 `manualChunks` 导致生产环境整站白屏，而 `typecheck`、`lint`、1300 个单元测试、`build` 全部通过——因为没有任何测试在真实浏览器里跑过这个应用。同理，一次「创建会话后跳转」的竞态在单元测试里无法复现，因为 mock 立刻返回数据，掩盖了响应延迟带来的时序窗口。

## 端到端测试

### 环境

`@playwright/test` 与本项目其它依赖一样装在 `frontend/node_modules`（沙盒内，不污染系统）。

浏览器二进制复用本机已缓存的 Chromium：

```
$HOME/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome
```

若路径不同，用环境变量覆盖：

```bash
PLAYWRIGHT_CHROMIUM_PATH=/path/to/chrome pnpm --filter frontend test:e2e
```

若该缓存不存在，安装浏览器：

```bash
pnpm --filter frontend exec playwright install chromium
```

### 结构

```
frontend/
  playwright.config.ts          # 两个 project：desktop / mobile
  e2e/
    helpers/
      static-server.mjs         # 从 dist/ 提供静态文件，SPA fallback，禁用 SW
      api-mocks.ts              # 全部后端 API 的确定性 mock
    specs/
      smoke.spec.ts             # 每个公开路由都能挂载，无未捕获异常
      repo-entry.spec.ts        # /repos/:id 的重定向契约
      right-panel-resize.spec.ts# 右侧栏拖拽 / 键盘 / 持久化
```

测试跑在 `dist/` 上，所以**改动源码后必须先构建**：

```bash
pnpm --filter frontend build && pnpm --filter frontend test:e2e
```

`webServer` 会自动拉起 `e2e/helpers/static-server.mjs`。关闭 service worker 拦截，避免缓存跨用例污染。

### 关于 API mock

`installApiMocks(page, overrides)` 拦截所有后端请求并返回固定数据，因此不需要后端、数据库或 OpenCode 进程。

关键能力是 **可注入延迟**：

```ts
await installApiMocks(page, {
  repos: [repo],
  sessionsByDirectory: { [repo.fullPath]: [makeSession('ses_a', repo.fullPath)] },
  latency: { repoMs: 1200, sessionsMs: 1500 },
})
```

这是刻意的设计。响应之间的相对延迟是竞态的必要条件，而 mock 立刻返回会把它们全部藏起来。新增涉及异步流程的测试时，**至少写一个带延迟的变体**。

可注入项：

- `repos` — `/api/repos` 与 `/api/repos/:id` 的返回，不存在的 id 返回 404
- `sessionsByDirectory` — 按目录分组的会话列表
- `latency.{repoMs,sessionsMs,sessionMs,messagesMs}` — 各接口延迟
- `sessionDetailStatus` — 强制 `/api/opencode/session/:id` 返回指定状态码

**路由注册顺序很重要**：Playwright 的 `page.route` 是**后注册先匹配**（LIFO）。因此 `api-mocks.ts` 里宽泛的 `**/api/opencode/**` catch-all 必须先注册，具体 handler 后注册才能生效。新增 handler 时把它加在 catch-all **之后**。

### 写新用例的约定

- 用 `expect(locator).toContainText(...)` / `toHaveURL(...)` 这类**自动重试**的断言，不要用固定 `waitForTimeout` 后再断言——后者在不同机器上会随机失败。
- 页面刚加载完时读取 `innerText()` 很容易读到中间态。让断言自己等。
- 拖拽类用例用 `page.mouse.move / down / move / up`。
- 需要断言「没有跳转到错误的 URL」时，监听 `framenavigated` 收集 URL 再筛选，比事后取 `page.url()` 可靠。

### 排查失败

```bash
# 失败时会保留 trace / 截图
pnpm --filter frontend exec playwright show-trace e2e-results/<用例目录>/trace.zip

# 只跑某个文件或某一行
pnpm --filter frontend exec playwright test repo-entry.spec.ts
pnpm --filter frontend exec playwright test repo-entry.spec.ts:17

# 带 UI 交互调试
pnpm --filter frontend test:e2e:ui
```

`e2e-results/` 是产物目录，不应提交。

## 渲染冒烟测试

`scripts/smoke-render.mjs` 覆盖桌面（1280×800）与移动（390×844）两个视口，断言：

- `#root` 非空且页面有可见文本
- 没有未捕获的 `pageerror`
- 没有 `/assets/` 请求失败（4xx/5xx）

它比端到端快、比单元测试真实，适合在每次构建后立即跑。**改动构建配置（`vite.config.ts`、分包、动态 import、service worker 预缓存）后必须跑它**——白屏这类问题只有它会报。

## 后端测试

```bash
pnpm --filter backend test          # bun test + vitest
pnpm --filter backend exec vitest run test/routes   # 单个目录
```

已知的环境依赖用例（本机可能失败，与代码无关）：

- `test/services/repo-git.test.ts` — 需要真实 git 网络访问
- `test/services/opencode-manager-tool-plugin.test.ts` — 需要已安装的 opencode 二进制
- `test/scripts/docker-entrypoint.test.ts` — 需要已安装的 opencode 二进制

`test/routes/settings.test.ts` 的超时相关用例偶发不稳定（含真实 `setTimeout` 与进程信号），重跑即可确认。

## 什么时候必须补哪一层

| 改动 | 至少补 |
|---|---|
| 纯函数 / hook 逻辑 | 单元测试 |
| 构建配置、分包、动态 import、SW | `smoke:render` |
| 路由跳转、重定向、URL 参数 | 端到端 |
| 依赖响应时序的异步流程 | 端到端 + **带延迟**的变体 |
| 拖拽 / 键盘 / 响应式布局 | 端到端（desktop 与 mobile 两个 project） |
| 错误路径（404、上游失败） | 端到端（构造对应 mock） |
