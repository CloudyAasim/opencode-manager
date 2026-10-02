/**
 * A client timeout shorter than the server's own is not a faster failure, it
 * is a failed success: the work lands on the server anyway and the user is
 * told it did not happen. Adding a repository from a URL spends up to five
 * minutes inside `git clone`, and the browser had been giving up at 45.
 *
 * These mirror budgets on the other side of the wire. Change one, change the
 * other:
 *   backend/src/services/repo/clone.ts            GIT_CLONE_TIMEOUT          300000
 *   backend/src/services/opencode-single-server.ts PLUGIN_INSTALL_TIMEOUT_MS 120000
 *   backend/src/routes/settings/opencode-lifecycle.ts  opencode upgrade       90000
 *
 * Each one carries a little headroom on purpose - the numbers below are the
 * server's budget plus 5s. If both sides fire at the same instant the user
 * gets our generic "Request timeout" instead of the server's actual git
 * error, which is the one worth reading.
 */
export const REQUEST_TIMEOUTS = {
  /** POST /api/repos - runs `git clone` inline */
  clone: 305_000,
  /** POST /api/settings/opencode-install-version - runs the installer */
  versionInstall: 125_000,
  /** POST /api/settings/opencode-upgrade - runs `opencode upgrade` */
  openCodeUpgrade: 95_000,
} as const

export type RequestTimeoutKey = keyof typeof REQUEST_TIMEOUTS

/**
 * Routes whose handler runs one of the long operations above. Declared rather
 * than inferred: the frontend cannot see the server's budget from here, and a
 * rule that guessed would be a rule that guessed wrong.
 */
export const LONG_RUNNING_ROUTES: ReadonlyArray<readonly [string, RequestTimeoutKey]> = [
  ['/api/repos', 'clone'],
  ['/api/settings/opencode-install-version', 'versionInstall'],
  ['/api/settings/opencode-upgrade', 'openCodeUpgrade'],
]
