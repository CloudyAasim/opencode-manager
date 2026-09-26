import { AsyncLocalStorage } from 'node:async_hooks'
import path from 'node:path'

export interface AccessScope {
  roots: string[]
  browseRoot: string
  repoBase: string
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

export function assertWithinAccessScope(target: string): void {
  const scope = getAccessScope()
  if (!scope) return
  if (!isWithinRoots(target, scope.roots)) {
    throw { message: 'Path is outside the allowed workspace', statusCode: 403 }
  }
}
