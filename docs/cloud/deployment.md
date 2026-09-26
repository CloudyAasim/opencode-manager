# VPS + Caddy 部署指南

本指南把 OpenCode Manager 部署到一台公网 VPS，使用 Caddy 自动申请 Let's Encrypt 证书。
部署完成后只有 `80/443` 对外开放，应用与 OpenCode 服务都不可从公网直连。

!!! tip "一键部署"
    推荐直接使用 `deploy/install.sh`（见 [一键部署](one-click-deploy.md)），它会自动完成
    配置生成、构建、启动与健康检查。下面是从零的手动步骤，便于理解每一步。

## 1. 前置条件

- 一台 Linux VPS（建议 2 vCPU / 4 GB 内存起步；使用 microVM 沙箱建议 ≥8 GB）。
- 一个域名，例如 `opencode.example.com`。
- 已把域名的 `A`/`AAAA` 记录指向 VPS 公网 IP。
- 已安装 Docker 与 Docker Compose v2。
- VPS 防火墙只放行 `22`（或你的 SSH 端口）、`80`、`443`。

## 2. 获取代码

```bash
git clone <your-fork-url> opencode-manager
cd opencode-manager/deploy
```

## 3. 生成密钥与配置

```bash
./gen-secrets.sh opencode.example.com you@example.com
```

脚本会生成 `deploy/.env`（权限 `600`），其中：

- `AUTH_SECRET`：随机会话密钥。
- `ADMIN_EMAIL` / `ADMIN_PASSWORD`：首个管理员账号，容器启动时创建。
- `AUTH_TRUSTED_ORIGINS` / `PASSKEY_*`：自动填成你的域名。

请手工确认以下项：

```bash
# 工作区必须是专用目录，绝不要用 $HOME 或 /
OCM_WORKSPACE_HOST_PATH=/srv/opencode/workspace

# 自注册保持关闭
AUTH_ALLOW_SIGNUP=false
```

`ADMIN_PASSWORD` 建议登录后在界面中修改，然后从 `.env` 中删除。

## 4. 启动

```bash
docker compose -f docker-compose.prod.yml up -d --build
docker compose -f docker-compose.prod.yml logs -f caddy
```

Caddy 首次启动会自动申请证书，稍等片刻后访问 `https://opencode.example.com`。

第一次打开会直接进入登录页（不是注册页）。用 `.env` 中的管理员账号登录。

## 5. 管理账号

- 登录后进入 **Settings → Users**。
- 点击 **Create user** 添加成员，设置邮箱、初始密码与角色。
- 用户首次登录后可在 **Account** 中修改密码、添加 Passkey。
- 服务不提供自助注册入口；所有账号均由管理员创建。

## 6. 网络与端口

| 端口 | 是否公网可达 | 说明 |
|------|--------------|------|
| 80 / 443 | 是 | Caddy：TLS 终止与反代 |
| 5003 | 否 | 应用 API（仅内部 docker 网络） |
| 5551 | 否 | OpenCode server（容器内回环） |
| 5100-5103 | 否 | 仓库内开发服务器用的预留端口 |

验证公网不可达：

```bash
nmap -Pn -p 5003,5551,5100-5103 opencode.example.com
```

预期全部为 `closed`/`filtered`。

> 注意：原版 `docker-compose.yml` 会把 `5003/5100-5103` 直接发布到宿主机。
> 生产环境请始终使用 `deploy/docker-compose.prod.yml`。

## 7. 反向代理与真实 IP

生产 compose 已设置 `AUTH_TRUST_PROXY=true`，并且 `Caddyfile` **覆盖而非追加**转发头：

```caddyfile
header_up X-Real-IP {remote_host}
header_up X-Forwarded-For {remote_host}
```

应用优先使用 `X-Real-IP`（Caddy 覆盖为直连对端），其次 `CF-Connecting-IP`，最后才用
`X-Forwarded-For` 的第一个值。这样即使客户端伪造 `X-Forwarded-For`，也无法绕过按 IP 的
登录限流与审计记录。

**只有**在 Caddy 之后才应开启 `AUTH_TRUST_PROXY`。如果直接暴露应用端口，必须保持
`AUTH_TRUST_PROXY=false`。

若 Caddy 前面还有 Cloudflare 等 CDN，请在 `reverse_proxy` 中配置 `trusted_proxies`，
让 `{remote_host}` 解析为真实客户端。

## 8. 可选：只允许你的网络访问

在 `Caddyfile` 中取消注释 IP 允许清单：

```caddyfile
@blocked not remote_ip 203.0.113.0/24 10.8.0.0/24
respond @blocked 403
```

或者使用 Cloudflare Tunnel / Tailscale 实现不暴露源站 IP（见安全方案）。

## Web 终端（可选）

镜像内置 `python3`，终端开箱可用，且**仅管理员**可访问：

- 管理员登录后，桌面端侧边栏 / 移动端「更多」中出现 **Terminal**
- 默认每位用户在 `/workspace/users/<安全ID>` 下拥有权限为 0700 的独立工作目录
- 审计记录写入容器内数据库表 `terminal_audit`，可在 **Settings → Audit Log** 查询与清理

可通过 `deploy/.env` 调整：

```bash
OCM_TERMINAL_ENABLED=true
OCM_TERMINAL_ADMINS_ONLY=true
# 每位用户独立目录（推荐）
# OCM_TERMINAL_PER_USER_HOME=true
# 必须位于工作区内，越界会回退到工作区根目录
# OCM_TERMINAL_CWD=/workspace
```

!!! warning
    不要关闭 `OCM_TERMINAL_ADMINS_ONLY`，也不要在未启用 HTTPS 的情况下开放终端。

## 9. 备份与恢复

`deploy/` 提供脚本，覆盖数据库卷（用户、会话、设置、审计）与工作区：

```bash
cd deploy

# 一致性备份（短暂停止 app，默认保留 7 份）
./backup.sh

# 不停机热备份（尽力而为）
BACKUP_ONLINE=1 ./backup.sh

# 恢复（必须先明确确认，或用 --yes）
./restore.sh --db backups/db-20260101-120000.tgz --yes
./restore.sh --workspace backups/workspace-20260101-120000.tgz --yes
```

可用环境变量：`BACKUP_DIR`、`BACKUP_RETENTION`、`COMPOSE_PROJECT_NAME`。
脚本会用 `alpine` 容器挂载卷进行打包/解包，并在恢复后按 `PUID:PGID` 修正属主。

建议用 systemd timer 或 cron 定时执行 `backup.sh`，并定期演练恢复。

## 10. 升级

```bash
git pull
docker compose -f docker-compose.prod.yml up -d --build
```

## 11. 上线验收清单

- [ ] `https://域名` 证书有效，HTTP 自动跳转 HTTPS。
- [ ] 未登录访问任意页面会跳转登录，任意 `/api/*` 返回 401。
- [ ] 页面上不存在注册入口，直接调用 `/api/auth/sign-up/email` 返回 403。
- [ ] 连续输错密码触发 `429`。
- [ ] 响应头包含 `Content-Security-Policy` 与 `Strict-Transport-Security`。
- [ ] `5003/5551/5100-5103` 从公网不可达。
- [ ] `OCM_WORKSPACE_HOST_PATH` 是专用目录，不包含 `$HOME` 或根目录。
- [ ] 已完成一次备份与恢复演练。
