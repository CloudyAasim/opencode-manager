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

!!! note "前提：这是一个服务器侧的 Docker 选项，仓库里管不着"
    容器以 `node` 非 root 运行（`Dockerfile` 的 `USER node`），而 `chroot` 需要
    `CAP_SYS_CHROOT`、`mount` 需要 `CAP_SYS_ADMIN` —— 非 root 进程两个都没有，**唯一**的获取途径
    是 user namespace。因此沙箱在结构上依赖「宿主允许创建非特权 user namespace」，
    **没有任何纯代码的办法绕开它**。

    Docker 默认的 seccomp 剖面会拦 `clone(CLONE_NEWUSER)`，表现为
    `unshare failed: Operation not permitted`。需要手工在应用上加：

    ```bash
    dokku docker-options:add <app> deploy "--security-opt seccomp=unconfined"
    dokku docker-options:add <app> run     "--security-opt seccomp=unconfined"
    ```

    **AppArmor 不用动。** 默认的 `docker-default` 剖面拦的是 mount propagation，而上面的
    `--propagation unchanged` 正是为了不去做那次传播变更，所以只要放开 seccomp 就够了
    （`dokku config` 也改不了 AppArmor）。

    这是 `2bf0b2a`（把部署配置从仓库移到服务器）之前，仓库里的部署脚本每次都会自动执行的两行。
    搬走时它们没有跟着搬过去，**沙箱从那天起就建不起来了**，而失败方式是静默的 ——
    普通用户点开终端，看到一个立刻退出的 shell。

    建不起来时**不会**退化成无隔离 shell：`TerminalManager` 在 spawn 之前就拒绝，
    非管理员终端直接不可用，管理员不受影响。要在服务器上实测：

    ```bash
    docker exec opencode-manager.web.1 \
      unshare --user --map-root-user --mount --propagation unchanged true \
      && echo SANDBOX_OK || echo SANDBOX_BLOCKED
    ```


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
