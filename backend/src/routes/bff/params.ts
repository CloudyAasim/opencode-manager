import type { Context } from 'hono'
import type { Principal } from '../../auth/ownership'
import { principalIsAdmin } from '../../auth/ownership'
import { isWithinRoots } from '../../auth/access-scope'
import { fail } from '../api-v1/respond'

/**
 * The working directories to list, in the order they were named.
 *
 * A directory is named by repeating the parameter, because a path is allowed
 * to contain characters that a separator would make ambiguous.
 */
export function directoriesOf(c: Context): string[] {
  const named = c.req.queries('directories') ?? []
  const seen = new Set<string>()
  const directories: string[] = []
  for (const entry of named) {
    const directory = entry.trim()
    if (!directory || seen.has(directory)) continue
    seen.add(directory)
    directories.push(directory)
  }
  return directories
}

/**
 * The working directories the caller named, checked against their own.
 *
 * A directory is the caller's to name only if it is one of theirs. A
 * directory that is not theirs has no business being named at all, and the
 * answer is a refusal rather than an empty list - the same rule everywhere
 * in this layer.
 */
export function checkedDirectoriesOf(
  c: Context,
  principal: Principal | null,
  roots: readonly string[],
): string[] | Response {
  const directories = directoriesOf(c)
  if (principalIsAdmin(principal)) return directories

  const strayed = directories.filter((directory) => !isWithinRoots(directory, roots))
  if (strayed.length > 0) {
    return fail(c, 403, 'forbidden', 'A working directory that is not yours was named')
  }
  return directories
}
