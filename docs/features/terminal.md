# Web 终端

在浏览器中访问服务器的 shell，工作目录被限定在安全工作区，仅管理员可用。

## 功能概览

- 基于 xterm.js 的完整终端体验（颜色、光标、滚动回放、窗口自适应）
- 后端通过 PTY 桥接（`backend/scripts/terminal-pty.py`）启动真实交互式 shell
- 输出走 SSE 流式传输，输入通过 POST 批量提交，兼容 Caddy 等反向代理
- 断线自动重连并按序号去重回放，不会重复输出
- 空闲超时、最长会话时长、每用户与全局并发上限
- 审计：每次会话记录用户、IP、User-Agent、shell、工作目录、开始/结束时间、退出码

## 使用方式

1. 以管理员账号登录
2. 桌面端左侧栏或移动端「更多」菜单中点击 **Terminal**
3. 页面顶部显示当前状态、shell 与工作目录；点击 **Reconnect** 可重建会话

界面文案支持中文（跟随「设置 → 通用 → 语言」或浏览器语言）。

## 安全模型

| 控制 | 说明 |
|------|------|
| 身份 | 默认 `OCM_TERMINAL_ADMINS_ONLY=true`，仅 `admin` 角色可访问（前端路由与后端接口双重校验） |
| 工作目录 | 默认每位用户独立：`WORKSPACE_PATH/users/<safeUserId>`（权限 0700，自动创建）；`OCM_TERMINAL_CWD` 必须位于工作区内，否则回退 |
| 运行身份 | 容器内非 root 用户（`node`），隔离边界是容器本身 |
| 并发 | 每用户默认 2 个、全局默认 4 个会话 |
| 生命周期 | 空闲 15 分钟自动关闭；绝对上限 8 小时 |
| 审计 | `terminal_audit` 表记录会话元数据 |
| 输入上限 | 单次输入 64 KB；尺寸最小 20x5 |

!!! warning "终端 = shell 权限"
    网页终端等同于把 shell 交给登录用户。请始终配合 HTTPS、管理员专用，并使用专用
    容器与专用工作目录。不要在宿主机直接运行本服务并开放终端。

## 工作流程

```
浏览器 xterm.js
   │  输入 (POST /api/terminal/sessions/:id/input)
   │  尺寸 (POST /api/terminal/sessions/:id/resize)
   │  输出 (GET  /api/terminal/sessions/:id/stream, SSE)
   ▼
TerminalManager ── TerminalSession ── PTY 桥接 (python3) ── /bin/bash
```

- 输入在客户端按 10ms 合并后提交，减少请求数
- 输出按 `seq` 编号，重连时携带 `?from=<seq>` 只回放新增部分
- 会话与登录用户绑定，其他用户无法访问

## 接口

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/terminal/config` | 运行时配置与可用性 |
| GET | `/api/terminal/sessions` | 当前用户的会话列表 |
| POST | `/api/terminal/sessions` | 创建会话（可选 `cols` / `rows`） |
| GET | `/api/terminal/sessions/:id/stream?from=0` | SSE：`ready` / `output` / `exit` / `heartbeat` |
| POST | `/api/terminal/sessions/:id/input` | 发送输入 `{ data }` |
| POST | `/api/terminal/sessions/:id/resize` | 调整尺寸 `{ cols, rows }` |
| DELETE | `/api/terminal/sessions/:id` | 关闭会话 |
| GET | `/api/admin/audit/terminal` | 审计查询（管理员，支持 `email` / `active` / `from` / `to` / `limit` / `offset`） |
| POST | `/api/admin/audit/terminal/prune` | 清理早于 `before`（epoch ms）的审计记录（管理员） |

错误码：`TERMINAL_DISABLED` / `TERMINAL_UNAVAILABLE` → 503，`TOO_MANY_SESSIONS` → 429，
`SESSION_NOT_FOUND` → 404，`FORBIDDEN` → 403。

## 配置

见 [环境变量](../configuration/environment.md#web-terminal)。

## 已知限制

- 不支持终端窗口尺寸的实时 SIGWINCH 之外的复杂协议；`script`/PTY 尺寸调整通过桥接的
  控制通道完成。
- 审计记录会话级元数据，不含逐条命令内容（如需命令级审计，可在 shell 中启用
  `PROMPT_COMMAND` 记录或后续扩展）。
- 依赖容器内 `python3`；缺失时接口返回 503 并在界面提示终端不可用。
