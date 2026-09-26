# Web 终端

在浏览器中访问受限 shell。普通用户运行在独立沙箱中，只能访问自己的工作区；管理员会话
在容器内直接运行（不额外沙箱）。

## 功能概览

- 基于 xterm.js 的完整终端体验（颜色、光标、滚动回放、窗口自适应）
- 后端通过 PTY 桥接（`backend/scripts/terminal-pty.py`）启动真实交互式 shell
- 输出走 SSE 流式传输，输入通过 POST 批量提交，兼容 Caddy 等反向代理
- 断线自动重连并按序号去重回放，不会重复输出
- 空闲超时、最长会话时长、每用户与全局并发上限
- 审计：每次会话记录用户、IP、User-Agent、shell、工作目录、开始/结束时间、退出码

## 使用方式

1. 登录任意账号
2. 桌面端左侧栏或移动端「更多」菜单中点击 **Terminal**（当 `OCM_TERMINAL_ADMINS_ONLY=true`
   时仅管理员可见）
3. 页面顶部显示当前状态、shell 与工作目录；点击 **Reconnect** 可重建会话

界面文案支持中文（跟随「设置 → 通用 → 语言」或浏览器语言）。

## 安全模型

| 控制 | 说明 |
|------|------|
| 身份 | `OCM_TERMINAL_ADMINS_ONLY` 默认 `false`（普通用户可用）；设为 `true` 时仅 `admin` 角色可访问（前端路由与后端接口双重校验） |
| 工作目录 | 普通用户使用 `WORKSPACE_PATH/users/<username>/workspace`；无用户名时使用 `WORKSPACE_PATH/users/<safeUserId>`（权限 0700，自动创建） |
| 普通用户隔离 | 沙箱内运行（见下文），只挂载自己的工作区 |
| 管理员 | 直接在容器内以 `node` 用户运行，不额外沙箱 |
| 并发 | 每用户默认 2 个、全局默认 4 个会话 |
| 生命周期 | 空闲 15 分钟自动关闭；绝对上限 8 小时 |
| 审计 | `terminal_audit` 表记录会话元数据 |
| 输入上限 | 单次输入 64 KB；尺寸最小 20x5 |

!!! warning "终端 = shell 权限"
    网页终端等同于把 shell 交给登录用户。普通用户终端运行在只暴露其工作区的沙箱内；
    管理员终端拥有容器内 `node` 用户权限。请始终配合 HTTPS，并让服务运行在专用容器中。

## 终端隔离（普通用户）

`backend/scripts/terminal-pty.py` 在启动普通用户 shell 前执行：

```
unshare --user --map-root-user --mount --propagation unchanged -- \
  /bin/sh backend/scripts/terminal-sandbox.sh <shell> <workspace>
```

`terminal-sandbox.sh` 会：

1. 以 tmpfs 作为新的根，仅绑定 `/usr`、`/bin`、`/sbin`、`/lib`、`/lib64`、`/etc`、`/opt`
   以及 `/proc`、`/dev`，并挂载独立的 `/tmp`；
2. 把该用户的 `workspace` 以可写方式挂到 `/workspace`，`HOME` 指向 `/workspace`；
3. `chroot` 后启动交互式 shell。

因此沙箱内**无法访问** `/app`（代码与 SQLite 数据库）、OpenCode 凭据、其他用户的数据或
`setting/`。系统目录的只读性来自 uid 映射：`--map-root-user` 把 `root` 映射为应用的 `node`
用户，root 拥有的系统文件成为未映射 id，`CAP_DAC_OVERRIDE` 不适用，普通权限位即拒绝写入
（容器根是 overlayfs，不支持以只读方式重新挂载，故不能依赖 `remount,ro`）。

!!! note "前提"
    容器的 seccomp 必须允许非特权 user namespaces。部署脚本已为 Dokku 应用添加
    `--security-opt seccomp=unconfined`。若宿主禁止创建 user namespace，普通用户终端将
    无法启动；可设置 `OCM_TERMINAL_ISOLATE=false` 关闭沙箱（不推荐），或仅保留管理员终端。


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
