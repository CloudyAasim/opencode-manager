# 一键部署（产品级）

目标：在一台干净的 Linux VPS 上，一条命令完成 HTTPS 生产部署。

## 0. 前提

- Linux VPS（建议 2 vCPU / 4 GB 起；终端用 microVM 建议 ≥8 GB）
- 已安装 Docker 与 Docker Compose v2（`docker compose version` 可用）
- **磁盘：构建期间建议至少 8–10 GB 空闲**。镜像为精简构建（slim 基础镜像、生产依赖、默认不装浏览器），
  最终镜像约 1.5–2.5 GB；构建后可用 `docker builder prune -af` 回收缓存。
- 一个域名，`A`/`AAAA` 已解析到该 VPS
- 防火墙放行 `22`（或你的 SSH 端口）、`80`、`443`

## 1. 一键安装

```bash
git clone <your-fork-url> opencode-manager
cd opencode-manager/deploy
./install.sh --domain opencode.example.com --email you@example.com
```

常用参数：

| 参数 | 说明 |
|------|------|
| `--domain` | 公网域名（必填） |
| `--email` | ACME 通知邮箱（默认 `admin@<domain>`） |
| `--admin-email` / `--admin-password` | 首个管理员（默认 `admin@<domain>` 与随机密码） |
| `--workspace` | 宿主机工作目录（默认 `~/opencode/workspace`） |
| `--puid` / `--pgid` | 容器工作区属主（默认当前用户） |
| `--force` | 重新生成 `.env`（会轮换密钥，慎用） |
| `--skip-build` / `--no-start` | 跳过构建 / 只准备配置 |
| `--dry-run` | 只打印计划，不做任何改动 |
| `-y, --yes` | 非交互（此时 `--domain` 必填） |

安装脚本会：校验依赖 → 生成 `.env`（随机 `AUTH_SECRET` 与管理员密码，权限 600）→
创建并 chown 工作区 → 检查 DNS 与 80/443 占用 → 构建镜像 → `docker compose up -d` →
等待健康检查 → 打印访问地址与管理员凭据。

**重复执行是安全的**：已有 `.env` 会复用，密钥不会轮换。

## 2. 安装后验收

```bash
./smoke-test.sh
```

会检查：

- HTTP 自动跳转 HTTPS
- `/api/health` 返回 200
- 响应包含 HSTS 与 CSP
- 未登录访问 `/api/terminal/config` 返回 401/403
- 自助注册返回 403
- 管理员登录成功、`/api/admin/users` 与 `/api/terminal/config` 可访问
- `5003/5551/5100-5103` 从公网不可达（需 `nmap`）

任一失败会以非零退出码结束，便于接入 CI/监控。

## 3. 日常运维

```bash
./backup.sh                         # 一致性备份（短暂停 app）
BACKUP_ONLINE=1 ./backup.sh         # 热备份
./restore.sh --db backups/db-<ts>.tgz --yes
./install-backup-timer.sh --hour 3  # 安装每日备份（systemd timer 或 cron）
./update.sh                         # 备份 + 重建 + 重启（--pull 可先 git pull）
./uninstall.sh                      # 停止并删除容器（保留数据卷）
./uninstall.sh --purge              # 连同数据卷一起删除
```

## 4. 目录说明

```
deploy/
├─ install.sh                 一键安装
├─ smoke-test.sh              部署后验收
├─ backup.sh / restore.sh     备份与恢复
├─ install-backup-timer.sh    备份定时任务
├─ update.sh / uninstall.sh   升级与卸载
├─ gen-secrets.sh             仅生成 .env（手动场景）
├─ lib.sh                     脚本共用安全读取函数
├─ docker-compose.prod.yml    仅暴露 80/443，app 不发布端口
├─ Caddyfile                  TLS、安全头、覆盖转发头、SSE 不缓冲
└─ .env.production.example    生产环境模板
```

## 5. 安全默认

- 仅 `80/443` 暴露；app 在内部网络，OpenCode 固定 `127.0.0.1:5551`
- Caddy 覆盖 `X-Forwarded-For`/`X-Real-IP`，按真实 IP 限流
- 禁止自助注册，账号由管理员创建
- `OCM_ALLOW_SERVER_ENV_EDIT=false`：非管理员不可写 OpenCode 进程环境变量
- 终端仅管理员、每用户独立工作目录（0700）、会话审计
- 容器 `no-new-privileges` + `init`，日志轮转（10MB×3）

## 6. 常见问题

| 现象 | 处理 |
|------|------|
| Caddy 无法签发证书 | 确认域名解析到本机、80/443 未被占用、防火墙放行 |
| 健康检查超时 | `docker compose -f docker-compose.prod.yml logs app` |
| 页面能开但接口 401 | 正常：未登录。用安装时打印的管理员账号登录 |
| 忘记管理员密码 | 在 `.env` 设 `ADMIN_PASSWORD` + `ADMIN_PASSWORD_RESET=true`，重启，登录后移除 reset |
| 端口 80/443 被占用 | `ss -ltnp` 找到并停止其他服务，或改用 Tailscale/Cloudflare Tunnel |
| 想限制访问来源 | 在 `Caddyfile` 启用 `remote_ip` 允许清单 |

详细步骤见 [VPS + Caddy 部署指南](deployment.md)。
