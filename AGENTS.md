# OpenCode WebUI - Agent Guidelines

## Commands

- `pnpm dev` - Start both backend (5003) and frontend (5173)
- `pnpm dev:backend` - Backend only: `bun --watch-path backend/src --watch backend/src/index.ts`
- `pnpm dev:frontend` - Frontend only: `pnpm --filter frontend dev`
- `pnpm build` - Build both backend and frontend
- `pnpm test` - Run backend tests: `pnpm --filter backend test` (vitest)
- `pnpm --filter frontend test:e2e` - End-to-end tests (Playwright, real browser). See TESTING.md
- `pnpm --filter frontend smoke:render` - Build-artifact render check. See TESTING.md
- See TESTING.md for which layer to use and how to write new tests
- `cd backend && vitest <filename>` - Run single test file
- `cd backend && vitest --ui` - Test UI with coverage
- `cd backend && vitest --coverage` - Coverage report (80% threshold)
- `pnpm typecheck` - `tsc -b`, the type check that actually reads the code
  (`tsc --noEmit -p tsconfig.json` checks **nothing**: the root tsconfig is `"files": []`
  plus references, so it builds an empty program and exits 0)
- `pnpm lint` - Lint both backend and frontend
- `pnpm lint:backend` - Backend linting
- `pnpm lint:frontend` - Frontend linting

## Code Style

- No comments, self-documenting code only
- No console logs (use Bun's logger or proper error handling)
- Strict TypeScript everywhere, proper typing required
- Named imports only: `import { Hono } from 'hono'`, `import { useState } from 'react'`

### Backend (Bun + Hono)

- Hono framework with Zod validation, Bun SQLite (bun:sqlite) database
- Error handling with try/catch and structured logging
- Follow existing route/service/utility structure
- Use async/await consistently, avoid .then() chains
- Test coverage: 80% minimum required

### Frontend (React + Vite)

- @/ alias for components: `import { Button } from '@/components/ui/button'`
- Radix UI + Tailwind CSS, React Hook Form + Zod
- React Query (@tanstack/react-query) for state management
- ESLint TypeScript rules enforced
- Use React hooks properly, no direct state mutations

### Architecture gates

`frontend/src/test/architecture/` (21 suites) and `backend/test/architecture/`
are executable rules, not tests of behaviour. They encode decisions that are
easy to state and easy to forget: one component per panel state, one face for
the navigation, one timeout budget per route, one place that knows the layer
names. Run them on their own:

```bash
pnpm --filter frontend exec vitest run src/test/architecture
```

`frontend/src/test/architecture/import-graph.ts` is the shared scanner - use it
rather than walking the tree yourself. Note that it deliberately excludes test
files from the graph, so "is this module under test" cannot be answered by it.

Writing a new gate:

- **Key the rule on structure or shape, never on a string it has already seen.**
  A rule written against the two paddings it had met let fifteen hand-rolled
  spinners through; a rule matching `py-12` matched one file in the whole repo
  (the owner) and had never fired.
- **A gate that silently matches nothing is worse than no gate.** Every suite
  asserts its own scan set: the collection is non-empty, or the detector
  recognises a sample written inline in the test. A padding is a free choice;
  a shape is the thing worth protecting.
- **Give it one mutation, written in a different spelling than the fix**, and
  confirm the reason it goes red is the rule itself and not some other problem
  the sample happened to carry.
- **A self-check must stay green after the defect it watches is fixed.**
  Asserting "the bad code is still there" inverts on the day you fix it.
- **When a mutation is meant to starve the scan set, empty all of it at once.**
  Clearing one of three contributing files proves nothing - the other two keep
  the set populated and the check passes for the wrong reason.
- If the obligation cannot be derived from syntax, **declare it and enforce the
  declaration** (`MUST_MOVE_THE_LIST_NOW`, `DECIDED` in `optimistic-writes`)
  rather than inventing a rule that flags correct code too.

### Async and state

Each of these was a live bug at some point; all of them are now gated.

- **Never `await` a name handed out as `x: mutation.mutate`.** It returns
  `void`, so the `await` yields for one microtask and comes back: an in-flight
  flag set before it is cleared before the request lands, a `finally` meant to
  run "once it settles" runs immediately, and any refetch behind it reads the
  state from *before* the change. Use the `xAsync` twin (`mutateAsync`).
- **`cancelQueries` rejects.** Going through it directly swallows the click
  that triggered the work. Go through `stopQueries`, which absorbs it.
- **A `try` that only has `finally` has no failure path.** Either the awaited
  call cannot reject, or the failure is invisible - a status load that leaves
  the panel blank, a save that fails silently while its sibling path toasts.
  Say which one it is.
- **An in-flight flag belongs in `finally`,** not on the success path.
- **An optimistic write needs a decision and a rollback.** The one that carries
  the meaning: a `setX` whose value is *also* the request payload is mirroring
  the server, so a failure has to put it back. `setSelectedCommit(hash)` is not
  - the server does not care which commit you are looking at. When that
  judgement cannot be derived, it goes in a decision table.
- **One concept, written once:** panel loading (`PanelLoading`), panel
  empty/error (`PanelMessage`), navigation items (`framework/navigation/navModel.ts`),
  layer names (`framework/layer/knownLayers.ts`). If you are about to draw
  another one, the gate that owns it will say so.
- **Dependencies point one way: feature → framework.** Cross-feature dialogs are
  registered in `knownLayers.ts` and must be opened from there.

### General

- DRY principles, follow existing patterns
- Use SOLID principles throughout design and implementation:
  - **Single Responsibility**: Each module/class/function should have one reason to change—keep responsibilities focused.
  - **Open/Closed**: Entities should be open for extension, closed for modification—prefer adding new code over altering stable code.
  - **Liskov Substitution**: Subtypes must be substitutable for their base types—no breaking expected behavior when swapping implementations.
  - **Interface Segregation**: Prefer small, specific interfaces over large, general ones—clients shouldn’t depend on methods they don’t use.
  - **Dependency Inversion**: Depend on abstractions, not concretions—inject dependencies and avoid hard-coding implementations.
- YAGNI: Don’t build or keep code you don’t need. If you change something, remove the unused parts. use the new code or keep the old, but don’t keep both.
- Never leave dead code: remove unused code, commented-out blocks, and unused variables/imports.
- ./temp/opencode is reference only, never commit has opencode src
- Use shared types from workspace package (@opencode-manager/shared)
- OpenCode server runs on port 5551, backend API on port 5003
- Prefer pnpm over npm for all package management
- Run `pnpm lint` after completing tasks to ensure code quality

## Before you call it done

```bash
pnpm typecheck                                  # tsc -b
pnpm lint
pnpm --filter frontend exec vitest run src/test/architecture
pnpm --filter frontend exec vitest run
pnpm build
pnpm --filter frontend test:e2e
```

`TESTING.md` covers which layer catches what. Two things it does not:

- **A green gate run is not evidence the gate works.** If you touched a gate,
  mutate its subject and confirm it goes red for the right reason.
- **After deploying, confirm the artefact, not the status code.** HTTP 200 on
  the site only means *something* is being served. Build locally and compare
  the hashed chunk name against the one the live `index.html` references; equal
  names mean the running build is the build you verified.
