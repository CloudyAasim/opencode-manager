import type { Context } from 'hono'

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
