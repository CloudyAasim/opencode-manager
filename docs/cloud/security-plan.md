# 云端部署安全方案（Cloud Security Plan）

本文档面向"把 OpenCode Manager 部署到公网、供个人多账号使用"这一目标，给出威胁模型、
目标架构、认证与授权模型、工作区/终端隔离设计，以及分阶段实施路线图。

> 适用版本：`opencode-manager` v0.18.0（本 Fork）
> 部署形态：VPS + 域名 + Caddy 自动 TLS，仅暴露 `80/443`，应用与 OpenCode 服务只在内网。

---

## 1. 目标与范围

### 1.1 目标

1. 服务可从公网访问，但**必须强制登录**后才能使用任何功能。
2. **禁止自行注册**：所有账号只能由管理员创建，支持多用户与角色（`admin` / `user`）。
3. 提供受限于安全根的**文件管理**（已有）与**Web 终端**（规划）。
4. 传输全程 TLS，应用端口不对公网暴露。
5. 具备基础的防爆破、防越权、审计与备份能力。

### 1.2 非目标（本轮不做）

- 面向公众的 SaaS 多租户计费。
- 完整的企业级 SSO / SCIM。
- 每用户独立 Linux 账户级别的强隔离（列为 Phase 3）。

---

## 2. 现状安全评估

| # | 风险 | 严重度 | 现状 | 处理阶段 |
|---|------|--------|------|----------|
| R1 | 无登录速率限制，可暴力破解密码 | 高 | `/api/auth/*` 无限流 | Phase 1 ✅ |
| R2 | 默认允许自助注册，首位陌生人可抢占管理员 | 高 | 仅配置 `ADMIN_*` 时才关闭注册 | Phase 1 ✅ |
| R3 | 无安全响应头（HSTS/CSP/Frame 等） | 中 | 无 | Phase 1 ✅ |
| R4 | 应用端口直接暴露，无 TLS 终止 | 高 | compose 暴露 5003/5100-5103 | Phase 1 ✅ |
| R5 | 无角色校验，`role` 字段未生效 | 中 | 仅检查登录 | Phase 1 ✅ |
| R6 | 无用户管理界面/接口 | 中 | 需手改数据库 | Phase 1 ✅ |
| R7 | CORS 对代理前缀反射任意 Origin | 中 | `REFLECT_ANY_ORIGIN_PREFIXES` | Phase 1 ✅（收紧） |
| R8 | `.env` 明文密钥、无生成/校验脚本 | 中 | 手工 | Phase 1 ✅ |
| R9 | 设置页可写服务端环境变量，公网高危 | 高 | `ServerEnvVarsSettings` | Phase 2 |
| R10 | 工作区未按用户隔离，全局共享 | 中 | 仓库/会话代理/偏好/置顶/模板/排程已按 owner 逻辑隔离；终端每用户目录 | Phase 6 ✅ |
| R11 | 无 Web 终端；即使有也无路径 jail | 高 | 已实现受限终端（仅管理员 + 工作目录约束） | Phase 2 ✅ |
| R12 | 无审计日志（登录、用户变更、命令执行） | 中 | 终端会话级审计已落库；用户变更写运行日志 | Phase 2 ✅（会话级） |
| R13 | 无备份/恢复与密钥轮换 | 中 | 手工 | Phase 3 |
| R14 | GitHub/GitHub OAuth 新用户自动创建 | 高 | better-auth 默认 | Phase 1 ✅（用户创建钩子） |
| R15 | 反代追加转发头导致按 IP 限流可被伪造绕过 | 高 | 已改为优先 `x-real-ip` + Caddy 覆盖转发头 | Phase 3 ✅ |
| R16 | 普通用户可写 OpenCode 进程环境变量（等效代码执行） | 高 | 生产默认仅管理员可写 | Phase 3 ✅ |

---

## 3. 目标架构

```
                 Internet
                    │  443/tcp (HTTPS)
                    ▼
        ┌───────────────────────────┐
        │        Caddy              │  ← 自动 Let's Encrypt
        │  TLS 终止 / HSTS / CSP    │    安全头 / 限流 / 可选 IP 允许清单
        └────────────┬──────────────┘
                     │ 内部 docker network（不发布端口）
                     ▼
        ┌───────────────────────────┐
        │   opencode-manager app    │  5003 (仅内网)
        │  Hono API + SPA + auth    │
        │  ┌─────────────────────┐  │
        │  │ OpenCode server     │  │  127.0.0.1:5551（仅回环）
        │  └─────────────────────┘  │
        │  /workspace (限定根)      │
        └────────────┬──────────────┘
                     │
             bind mount: 仅一个安全根目录
```

关键原则：

- **单入口**：只有 Caddy 映射宿主机端口，应用用 `expose` 而非 `ports`。
- **横向不暴露**：OpenCode server 固定 `127.0.0.1`，仅由 app 访问。
- **最小工作区**：只把专用目录（如 `/srv/opencode/workspace`）挂进容器，绝不挂 `$HOME` 或 `/`。

---

## 4. 认证与授权模型

### 4.1 认证

- 采用 better-auth：邮箱密码 + 可选 Passkey；OAuth 默认关闭。
- `AUTH_SECRET` 必须为 32 字节随机值，生产环境缺失则拒绝启动（已有）。
- Cookie：`httpOnly` + `sameSite=lax` + `secure`（HTTPS 下）。
- 会话有效期默认 7 天，可配置。

### 4.2 注册与账号生命周期

- **默认 `AUTH_ALLOW_SIGNUP=false`**：任何自助注册（邮箱或 OAuth 首次登录）都会被拒绝。
- 账号只能通过以下方式产生：
  1. 环境变量 `ADMIN_EMAIL` / `ADMIN_PASSWORD` 引导首个管理员（推荐，容器启动时创建）。
  2. 管理员在 **Settings → Users** 中创建用户。
- 实现层面使用 better-auth 的 `user.create.before` 钩子做**统一入口拦截**，并额外在 HTTP
  层对 `/api/auth/sign-up/*` 返回 `403`，避免仅依赖前端隐藏。
- 可选 `AUTH_ALLOWED_EMAILS`：白名单邮箱（逗号分隔），用于受控的临时邀请。

### 4.3 授权

- 角色：`admin`（管理用户、查看全部）与 `user`（使用功能）。
- 所有 `/api/*`（除 `/api/auth`、`/api/auth-info`、`/api/health`）要求已登录。
- `/api/admin/*` 额外要求 `role === 'admin'`。
- 保护性约束：不能删除/降级最后一个管理员，不能删除自己。

### 4.4 防爆破

- better-auth 内置限流（内存存储，单实例适用）：
  - `/sign-in/email`：60s / 5 次
  - `/sign-up/email`：60s / 3 次
  - `/sign-in/passkey`：60s / 10 次
- 通过 `advanced.ipAddress.ipAddressHeaders` 读取 `x-forwarded-for`，确保按真实客户端 IP 限流
  （仅在受信反代后启用；直连时忽略伪造头，见 Phase 2 增强）。
- Caddy 层再加一道连接级限流作为纵深防御。

---

## 5. 工作区与终端隔离模型

用户要求"通过云服务控制云服务器工作目录下的终端、管理该目录下的文件，且工作目录被限定到安全位置"。

### 5.1 文件管理（已有能力）

现有 Files 功能已限定在 `WORKSPACE_PATH` 下。Phase 2 将补充：

- 统一路径规范化与符号链接逃逸校验（`realpath` 后前缀匹配）。
- 拒绝访问 `/app/data`、`.opencode/state` 等敏感目录。

### 5.2 Web 终端（Phase 2 设计）

三种可选隔离级别，复杂度从低到高：

| 方案 | 隔离度 | 说明 |
|------|--------|------|
| A. 容器内 PTY + 路径 jail | 中 | 后端为容器内 `node` 用户启动 shell，工作目录固定为 `/workspace`；最易实现 |
| C. 每用户独立容器 | 最高 | 每个用户一个容器/命名空间，资源与文件强隔离 |

推荐 **Phase 2 采用 A**（在已加固的容器内、以非 root 用户、限定 cwd + 命令白名单/超时），
后续按需升级到 C。**当前已按 A 实现**：SSE + POST 的 PTY 桥接、仅管理员、工作目录约束、
空闲/时长限制与会话级审计；无论哪种方案都必须：

- 仅限 `admin` 或显式授权的用户使用；
- 终端会话与登录会话绑定，登录失效即断开；
- 记录完整命令审计（R12）；
- 设置空闲超时、最大时长、最大并发；
- 不做任何绕过工作区边界的挂载。

> 注意：**Web 终端本质上等于把服务器 shell 暴露给登录用户**。因此本方案的底线是
> "仅管理员可用 + 容器内非 root + 专用工作区"，并且强烈建议配合防火墙/IP 允许清单。

---

## 6. 密钥与配置管理

- `AUTH_SECRET`：`openssl rand -base64 32` 生成，`deploy/gen-secrets.sh` 辅助。
- 所有密钥只经环境变量注入，`.env` 权限 `600`，且永不提交（`.gitignore` 已忽略）。
- `ADMIN_PASSWORD_RESET` 一次性使用，重置后必须移除。
- `.env.example` 标注生产必填项与不安全默认值。

---

## 7. 传输与网络

- Caddy 自动申请/续期证书，HTTP 强制跳转 HTTPS。
- 应用不发布宿主机端口，只在内部网络可达。
- 可选：Caddy `remote_ip` 允许清单，仅放行家庭/办公出口 IP 或 VPN 网段。
- 可选：Cloudflare Tunnel / Tailscale 作为"零暴露"替代方案（见部署文档）。

---

## 8. 云端集成（Phase 3）

- 工作区快照/备份到 S3/R2（对象存储），支持定时与手动恢复。
- 出站 Webhook / 通知（任务完成、异常）。
- 结构化日志导出与基础指标（健康、请求、失败登录）。

---

## 9. 分阶段路线图

### Phase 1（本轮已实现）

- ✅ 自助注册默认关闭，统一 `user.create.before` 拦截
- ✅ 管理员用户管理 API 与界面（创建/列表/删除/改角色/重置密码）
- ✅ `requireAdmin` 中间件与角色校验
- ✅ 登录限流与按真实 IP 限流
- ✅ 安全响应头（HSTS / CSP / X-Frame-Options / Referrer-Policy / Permissions-Policy）
- ✅ CORS 收紧
- ✅ 生产部署编排：`deploy/docker-compose.prod.yml` + `deploy/Caddyfile` + 密钥脚本
- ✅ 部署与认证文档
- ✅ 多语言基础设施（`en` / `zh-CN`）与核心界面中文化

### Phase 2（已实现终端）

- ✅ Web 终端（隔离方案 A）：SSE + POST 的 PTY 桥接、工作目录约束、审计、空闲/时长限制、仅管理员
- ✅ 终端审计表 `terminal_audit`（会话元数据）+ 管理员审计查询界面与 API
- ✅ 每用户终端工作目录隔离（`WORKSPACE_PATH/users/<safeUserId>`，权限 0700）
- [x] 设置页高危项（服务端环境变量写入）在公网模式下默认锁定
- [x] 反代场景下忽略伪造的 `x-forwarded-for`（优先 `x-real-ip`，Caddy 覆盖转发头）
- [ ] 每用户仓库/会话级数据隔离（需要给 repos/sessions/settings 增加 user 维度）

### Phase 3

- ✅ 数据库卷与工作区备份/恢复脚本（`deploy/backup.sh`、`deploy/restore.sh`，支持保留策略与一致性快照）
- ✅ 非管理员服务端环境变量写入锁定（`OCM_ALLOW_SERVER_ENV_EDIT`）
- ✅ 反代真实 IP 加固（优先 `x-real-ip`，Caddy 覆盖 `X-Forwarded-For`）
- [ ] 备份到 S3/R2 与一键恢复
- [ ] 每用户容器级隔离 / microVM 终端
- [ ] 密钥轮换、指标与告警

---

## 10. 上线验收清单

- [ ] `AUTH_SECRET` 为随机 32 字节，且与开发环境不同。
- [ ] `ADMIN_EMAIL` / `ADMIN_PASSWORD` 已设置，或已改为强密码。
- [ ] 浏览器访问 `https://域名` 自动跳转且证书有效。
- [ ] 未登录访问任意页面/接口均跳转登录或返回 401。
- [ ] 无法通过界面或直接调用接口完成自助注册。
- [ ] 连续错误登录触发 429。
- [ ] 响应包含 HSTS 与 CSP 等安全头。
- [ ] `5003` / `5551` / `5100-5103` 在公网不可达（`nmap` 验证）。
- [ ] 工作区只挂载了专用目录，未包含 `$HOME` 或根目录。
- [ ] 非管理员访问 `/terminal` 与 `/api/terminal/*` 被拒。
- [ ] 已配置备份与恢复演练。
