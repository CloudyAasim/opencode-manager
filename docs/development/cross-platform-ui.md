# Cross-platform client & UI direction

OpenCode Manager is a cloud workspace product. The same React/Vite frontend is
shipped three ways:

| Target | Technology | Notes |
| --- | --- | --- |
| Web | existing Vite build served by the backend | default deployment |
| Windows | Electron (`electron-app/`) + a Node same-origin proxy (`desktop/`) | NSIS installer and a portable build |
| Linux | Electron, same code as Windows | not packaged yet |
| Android | native Kotlin shell (`android/`) + a hand-written HTTP/1.1 proxy | Android 8.0+ (`minSdk 26`), no AndroidX |

> **The Tauri target this document used to describe was never scaffolded.** There is
> no `src-tauri/` in the repository, no `tauri.conf.*` anywhere in the tree and no
> Tauri dependency in any `package.json`; the Windows client is Electron and the
> Android client is a native Kotlin shell. Both were built that way on purpose:
> the Android shell must not depend on AndroidX so its proxy can be tested on a
> plain JDK, and the Windows client reuses the proxy the desktop package already
> had. (Corrected at `6eb45140`; the Tauri text was checked at `f26e2ee` and was
> a direction, never a scaffolded target.)

## Repository layout

```
frontend/        React + Vite UI (shared by web, desktop and Android)
backend/         Bun + Hono API
desktop/         the Node same-origin proxy, shared by the CLI and the Electron shell
electron-app/    the Windows shell (not a workspace member - see below)
android/         the native Android shell, independent of everything above
```

> `electron-app/` is **not** in `pnpm-workspace.yaml`, and that is deliberate: the
> Electron binary is 266 MB unpacked, and a server that never loads a desktop
> runtime should not download one on every build. The package has its own
> `package-lock.json`, and the CI job that runs its tests installs with
> `--ignore-scripts`, so the binary is never downloaded there.

## Building

```bash
# Web (default deployment)
pnpm --filter frontend build

# Windows client (NSIS installer + portable build)
cd electron-app && npm install && npm run package

# Android (requires the Android SDK, JDK 17)
./gradlew :app:assembleDebug
```

The desktop/mobile client talks to a self-hosted server: point it at the
deployment origin (`https://code.example.com`) on first launch, or let the
client find one on the machine.


## UI direction

The UI stays on **shadcn/ui + Tailwind** (already used) and follows the
chat-first application shell popularised by mature clients such as LobeChat,
Jan, and Open WebUI, adapted to a cloud workspace:

- **The palette is KDE's Breeze.** The light theme is Breeze (Paper White cards
  on Cardboard Gray, Plasma Blue for what is selected), the dark one is
  Breeze Ocean (the ocean-blue window, the same Plasma Blue). The values come
  from KDE's own colour files rather than from memory, they live in one place -
  the token layer in `frontend/src/index.css` - and a gate
  (`frontend/src/test/architecture/theme-tokens.test.ts`) holds the two themes
  to the same token set, to the palette's identity, and to a legible contrast
  on the primary button.

- **The geometry is Breeze's too.** The palette is only half of a design
  system; the other half is shape. The corner-radius scale is one scale
  (4/6/8/12px), used everywhere, because "soft" is the relationship between
  the steps and not a bigger number. Icons are monochrome and share one
  line weight (one CSS rule, not 100+ call sites). Buttons and text fields
  keep at least 8px of breathing room inside. Spacing lands on a 4px grid.
  Every surface that floats above the page is glass, and the top bar and
  the status strip float clear of the screen edge when there is room for
  them, the way a Plasma 6 panel does. These are stated as rules in
  `frontend/src/test/architecture/breeze-design.test.ts`, which keys on the
  shape of the markup rather than on the names of the files.

- **Colours come from tokens, not from the library.** `components/ui/`,
  `features/source-control/` and `lib/` are held to a hard rule: no
  Tailwind palette classes, only semantic tokens (`--color-primary`,
  `--color-destructive`, `--color-diff-add`, ...). The rest of `features/`
  is held to a baseline that may only go down. A gate that is red on the
  day it is written is a gate that gets deleted rather than obeyed.

- **Top bar** — the *only* navigation surface, at every width. Primary spaces:
  Projects, Assistant, Files, Schedules, Settings, Terminal (Terminal is
  permission-gated); account and logout are pushed conditionally. Items,
  their visibility and their targets are all derived in one place,
  `frontend/src/framework/navigation/navModel.ts`.
- **No sidebar, no bottom tab bar.** Both existed and both were removed: with
  every entry carrying a text label, four labelled buttons plus the repo
  switcher do not fit below 1024px, which is exactly the iPad portrait band.
  The shell switches to an overflow sheet below the `expanded` breakpoint
  (1024px) rather than at 768px.
- **Main pane** — the active surface: chat console for sessions/assistant,
  list/grid for repos and schedules.
- **Right context panel** — files, diffs, tool calls and session details,
  toggled per surface instead of modal-heavy dialogs.
- **Command palette** — `Ctrl/Cmd-K` for navigation and actions.
- **Composer** — bottom-pinned, multi-line, with model/agent selectors.
- **Mobile** — safe-area insets, full-screen sheets instead of side panels,
  `minSdk 34`. Navigation collapses into the same top bar.

Design tokens live in `frontend/src/index.css`; components in
`frontend/src/components/ui` are the single source of visual truth.

## Multi-tenant rules the UI must always respect

- Normal users only see their own workspace (`users/<username>/`), their own
  repos, and the shared system resources they are allowed to use.
- The Assistant is per-user.
- Provider credentials are per-user (`users/<username>/opencode.json`).

## Phases

1. Application shell (top bar + main + context panel) and command palette —
   done, and the sidebar / bottom-tab-bar parts were dropped rather than
   finished.
2. Chat console redesign (message grouping, composer, tool/diff rendering).
3. Repos and schedules list/grid redesign.
4. Settings as a two-pane surface.
5. Tauri desktop packaging + CI artifacts.
6. Android packaging (`minSdk 34`) + responsive polish.
