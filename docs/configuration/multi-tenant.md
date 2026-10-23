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
| Repository list / detail | their own repositories and shared system repositories | their own repositories and shared system repositories |
| Web terminal | unconfined, inside the container | sandboxed to `users/<username>/workspace` |
| User management, audit log | yes | no |

A repository is a **tenant resource**: it belongs to the account that created
it, and the role does not open it. The administrator manages the *server* -
accounts, the audit log, the OpenCode process, the terminal, the workspace on
disk - and the whole-workspace rows above are that side. A working copy inside
somebody else's directory is that person's work, and it is not a server
resource.

This used to read "all repositories" for the administrator. `canAccessRepoOwner`
answered "yes" for an administrator whatever the owner was, and the top bar's
project switcher is built from `GET /api/repos` - so the dropdown listed every
account's every project, and two accounts with a checkout of the same name
produced two identical entries. The shared rows are still shared: `user_id IS
NULL` is how the Assistant repository is stored, and it is the only thing that
should ever be ownerless.

Enforcement is implemented with a request-scoped access scope
(`backend/src/auth/access-scope.ts`) resolved from the session
(`resolveAccessRoots`), and applied by:

- `services/file-operations.ts` — every file operation asserts the resolved path
  is inside the scope;
- `services/files.ts` — relative paths resolve against the account's browse root;
- `services/archive.ts` — zip creation is scoped the same way;
- `services/filesystem.ts` — the folder picker is rooted at the account's
  workspace (there is no `REPO_BROWSE_ROOT` escape hatch).

The project surface uses `resolveTenantAccessRoots` instead: the account's own
workspace, their own settings, and the directories their own repositories live
in. The administrator's tenant is theirs too — they keep the whole workspace in
the file browser, which is the server-side reach, and it is a different
question from "whose project is this".

Relative paths are resolved against the account's browse root; repositories are
created under `users/<username>/workspace/repos` and always persist an absolute
`source_path` so reads never depend on a shared base directory.

## Administrator

Administrators bypass the per-user restriction for the *server* and can browse
and edit the whole workspace, including every account's directory. They do not
get to open another account's projects, read their files through the project
surface, or drive their schedules.

## 中文摘要

- 每个账号有独立工作区 `users/<用户名>/`，其仓库建于 `users/<用户名>/repos/`。
- 普通用户的「文件管理/浏览」限制在自己的工作区内，并允许访问「自己名下的仓库」与「共享系统仓库（如助手）」。
- 管理员可访问整个工作区——那是**服务器**这一侧的能力（账号、审计、OpenCode 进程、终端）。
- **项目是租户资源，管理员也不例外**：项目列表与详情只含自己的项目与共享系统仓库。
  管理员不再能看到别人目录下的工作副本，也不再能把它们选进顶栏的项目下拉。
- 访问控制在请求级按登录会话解析并强制执行；相对路径基于该账号的工作区解析，仓库一律记录绝对 `source_path`。
- 已移除 `REPO_BROWSE_ROOT`，目录浏览不再依赖全局环境变量。
