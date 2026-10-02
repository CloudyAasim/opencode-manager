# Contributing

Guide for contributing to OpenCode Manager.

## Getting Started

1. Fork the repository
2. Clone your fork
3. Set up local development (see [Local Setup](setup.md))
4. Create a feature branch
5. Make changes
6. Submit a pull request

## Code Style

- No comments — code should be self-documenting
- No console.log — use proper logging
- Strict TypeScript — proper typing everywhere
- Named imports — no default imports
- DRY principles — don't repeat yourself
- SOLID design — follow SOLID principles

## Pull Request Process

### Before Submitting

1. `pnpm typecheck`
2. `pnpm lint`
3. Architecture gates: `pnpm --filter frontend exec vitest run src/test/architecture`
4. Frontend unit tests: `pnpm --filter frontend exec vitest run`
5. Backend tests: `pnpm --filter backend exec vitest run`
6. End-to-end: `pnpm --filter frontend test:e2e`
7. Verify your changes work manually

`pnpm test` covers the cli, backend and frontend vitest suites, and the
frontend one picks up the architecture gates too - so steps 3 and 4 above are
already inside it, and they are listed separately only because they are the
ones worth watching while you work. What it never does is anything in a real
browser: the render smoke test and the end-to-end suite are the two layers it
cannot cover, which is why they are steps 5 and 6. `TESTING.md` explains what
each layer catches and what it cannot.

The architecture gates are worth running first and thinking about before you
write the gate: a rule that matches nothing is indistinguishable from a rule
that correctly passes, so a new gate needs a check that its own scan set is
non-empty, plus one mutation written differently from the fix it guards.

### Commit Messages

Format: `type: brief description`

Types:
- `feat` - New feature
- `fix` - Bug fix
- `docs` - Documentation
- `refactor` - Code refactoring
- `test` - Adding tests
- `chore` - Maintenance

Examples:
```
feat: add file upload progress indicator
fix: resolve session expiry on mobile
docs: update installation guide
refactor: extract git service from routes
```
