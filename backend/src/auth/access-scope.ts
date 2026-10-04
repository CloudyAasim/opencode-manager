import { AsyncLocalStorage } from 'node:async_hooks'
import path from 'node:path'

export interface AccessScope {
  roots: string[]
  browseRoot: string
  repoBase: string
  username?: string | null
}

const storage = new AsyncLocalStorage<AccessScope>()

export function runWithAccessScope<T>(scope: AccessScope, fn: () => T): T {
  return storage.run(scope, fn)
}

export function getAccessScope(): AccessScope | null {
  return storage.getStore() ?? null
}

export function isWithinRoots(target: string, roots: string[]): boolean {
  if (roots.length === 0) return false
  const resolved = path.resolve(target)
  return roots.some((root) => {
    const resolvedRoot = path.resolve(root)
    return resolved === resolvedRoot || resolved.startsWith(`${resolvedRoot}${path.sep}`)
  })
}

/**
 * Request-scope check, and nothing more. Outside a request it does not run.
 *
 * The no-scope branch returns silently on purpose, and that is a settled
 * decision rather than an oversight:
 *
 * - Only the HTTP middleware in `index.ts` calls `runWithAccessScope`.
 *   `resolveFilePath` in `file-operations.ts` sits behind startup paths too -
 *   `index.ts` seeds AGENTS.md on boot and the assistant-mode service reads and
 *   writes its skill files - so a fail-closed version throws during startup and
 *   takes the server down with it.
 * - The destructive paths that can actually take a checkout with them are not
 *   standing on this function. `repo/delete.ts`, `repo/clone.ts` and
 *   `repo/worktree.ts` each carry a check intrinsic to the operation, because a
 *   guard that only exists while a request is in flight is not a guard for a
 *   scheduled job.
 *
 * What this means for a caller: it is fine for deciding whether a *user-supplied
 * path from a request* is inside that user's workspace. It is not a containment
 * check, and it must not be used as one - a background job, a test, or a new
 * non-route caller would get a silent pass. `resolveRepoPathInsideBase` in
 * `repo/paths.ts` is what a destructive operation should use instead.
 */
export function assertWithinAccessScope(target: string): void {
  const scope = getAccessScope()
  if (!scope) return
  if (!isWithinRoots(target, scope.roots)) {
    throw { message: 'Path is outside the allowed workspace', statusCode: 403 }
  }
}
