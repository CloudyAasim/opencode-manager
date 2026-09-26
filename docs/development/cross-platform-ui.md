# Cross-platform client & UI direction

OpenCode Manager is a cloud workspace product. The same React/Vite frontend is
shipped three ways:

| Target | Technology | Notes |
| --- | --- | --- |
| Web | existing Vite build served by the backend | default deployment |
| Windows | Tauri v2 | NSIS/MSI installers |
| Linux | Tauri v2 | AppImage and `.deb` |
| Android | Tauri v2 mobile | Android 14+ (`minSdk 34`), phone UI |

Tauri v2 is used because it targets desktop **and** mobile from one codebase,
produces small binaries, and reuses the existing web UI unchanged.

## Repository layout

```
frontend/        React + Vite UI (shared by web, desktop and Android)
backend/         Bun + Hono API
src-tauri/       Tauri v2 shell (desktop + Android)
```

## Building

```bash
# Web (default deployment)
pnpm --filter frontend build

# Desktop app (Linux AppImage / deb, Windows installers)
pnpm dlx @tauri-apps/cli@^2 build

# Android (requires Android SDK + NDK, JDK 17)
pnpm dlx @tauri-apps/cli@^2 android init
pnpm dlx @tauri-apps/cli@^2 android build
```

Icons are generated once with `pnpm dlx @tauri-apps/cli@^2 icon <path-to-1024px-png>`.

The desktop/mobile client talks to a self-hosted server: point it at the
deployment origin (`https://code.example.com`) on first launch.

## UI direction

The UI stays on **shadcn/ui + Tailwind** (already used) and follows the
chat-first application shell popularised by mature clients such as LobeChat,
Jan, and Open WebUI, adapted to a cloud workspace:

- **Left sidebar** — collapses; primary spaces: Workspace, Assistant, Repos,
  Schedules, Files; account + settings pinned at the bottom.
- **Main pane** — the active surface: chat console for sessions/assistant,
  list/grid for repos and schedules.
- **Right context panel** — files, diffs, tool calls and session details,
  toggled per surface instead of modal-heavy dialogs.
- **Command palette** — `Ctrl/Cmd-K` for navigation and actions.
- **Composer** — bottom-pinned, multi-line, with model/agent selectors.
- **Mobile** — bottom tab bar, safe-area insets, full-screen sheets instead of
  side panels, `minSdk 34`.

Design tokens live in `frontend/src/index.css`; components in
`frontend/src/components/ui` are the single source of visual truth.

## Multi-tenant rules the UI must always respect

- Normal users only see their own workspace (`users/<username>/`), their own
  repos, and the shared system resources they are allowed to use.
- The Assistant is per-user.
- Provider credentials are per-user (`users/<username>/opencode.json`).

## Phases

1. Application shell (sidebar + main + context panel) and command palette.
2. Chat console redesign (message grouping, composer, tool/diff rendering).
3. Repos and schedules list/grid redesign.
4. Settings as a two-pane surface.
5. Tauri desktop packaging + CI artifacts.
6. Android packaging (`minSdk 34`) + responsive polish.
