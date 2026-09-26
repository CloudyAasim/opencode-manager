# Multi-tenant Model & Permissions

OpenCode Manager runs as a single server that hosts multiple accounts. Access is
enforced per request from the authenticated session; there is no shared "everyone
sees everything" mode for normal users.

## Workspace layout

Every account has an isolated directory tree under the configured workspace:

```
$WORKSPACE_PATH/
├── users/
│   └── <username>/
│       ├── workspace/          # the account's workspace root (projects, files)
│       │   └── repos/          # repositories created by that account
│       └── setting/            # per-user configuration and assistant
│           └── assistant/      # the account's dedicated assistant
└── repos/                      # system/shared repositories (e.g. the shared Assistant)
```

- `<username>` is assigned when the account is created and is never an OS user.
- `workspace/repos/<name>` is the default clone/register target for a normal account.
- `setting/` holds the account's `opencode.json` (providers/models) and its assistant.
- System repositories (ownerless) live under `repos/` and are managed by the
  server (the shared Assistant repository is one of them).

## Access rules

| Resource | Administrator | Normal user |
| --- | --- | --- |
| Folder browsing | whole workspace | `users/<username>/` |
| File read/write/upload/delete, archive | whole workspace | `users/<username>/` + their own and shared system repos |
| Repository list / detail | all repositories | their own repositories and shared system repositories |
| Web terminal | unconfined, inside the container | sandboxed to `users/<username>/workspace` |
| User management, audit log | yes | no |

Enforcement is implemented with a request-scoped access scope
(`backend/src/auth/access-scope.ts`) resolved from the session
(`resolveAccessRoots`), and applied by:

- `services/file-operations.ts` — every file operation asserts the resolved path
  is inside the scope;
- `services/files.ts` — relative paths resolve against the account's browse root;
- `services/archive.ts` — zip creation is scoped the same way;
- `services/filesystem.ts` — the folder picker is rooted at the account's
  workspace (there is no `REPO_BROWSE_ROOT` escape hatch).

Relative paths are resolved against the account's browse root; repositories are
created under `users/<username>/workspace/repos` and always persist an absolute
`source_path` so reads never depend on a shared base directory.

## Administrator

Administrators bypass the per-user restriction and can browse and edit the whole
workspace, including every account's directory.

## 中文摘要

- 每个账号有独立工作区 `users/<用户名>/`，其仓库建于 `users/<用户名>/repos/`。
- 普通用户的「文件管理/浏览」限制在自己的工作区内，并允许访问「自己名下的仓库」与「共享系统仓库（如助手）」。
- 管理员可访问整个工作区。
- 访问控制在请求级按登录会话解析并强制执行；相对路径基于该账号的工作区解析，仓库一律记录绝对 `source_path`。
- 已移除 `REPO_BROWSE_ROOT`，目录浏览不再依赖全局环境变量。
