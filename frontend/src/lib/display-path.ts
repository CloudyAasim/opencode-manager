export function getRepoRelativeDisplayPath(currentPath: string, basePath: string): string {
  const baseParts = basePath === '.' ? [] : basePath.split('/').filter(Boolean)
  const pathParts = currentPath === '.' ? [] : currentPath.split('/').filter(Boolean)
  const isWithinBase = baseParts.every((part, index) => pathParts[index] === part)
  const subParts = isWithinBase ? pathParts.slice(baseParts.length) : pathParts
  return subParts.length > 0 ? '/' + subParts.join('/') : '/'
}

const WORKSPACE = 'workspace'
const ASSISTANT = 'assistant'
const USERS = 'users'
const SETTING = 'setting'
const BASE = 'workspace'

/**
 * Turns the path the file browser actually holds into the path to show.
 *
 * The browser does not hold an absolute path. It holds `currentPath`, which
 * starts empty and grows by `name` and `..` as the user navigates, and it is
 * resolved against `workspaceRoot` - the real browse root the server sends
 * back with every listing. So this takes the two, resolves them into one real
 * path, and shortens that.
 *
 * Passing the root matters more than it looks. The relative path alone says
 * `src` or `../setting/assistant`, which cannot be shortened because it does
 * not say what it is relative to. A previous version of the header guessed,
 * hardcoding a `workspace` prefix and inventing a `repos` segment in front of
 * whatever the user was actually looking at.
 */
export function toDisplayPathFrom(workspaceRoot: string | undefined, currentPath: string): string {
  if (!workspaceRoot) {
    // No root means the listing never arrived, so there is nothing real to
    // shorten. Showing the raw path beats showing a confident wrong one.
    return toDisplayPath(currentPath)
  }
  return toDisplayPath(resolveAgainstRoot(workspaceRoot, currentPath))
}

/** Joins a relative path onto a root the way the filesystem would. */
export function resolveAgainstRoot(root: string, currentPath: string): string {
  const parts: string[] = []
  for (const segment of root.split('/')) {
    if (segment && segment !== '.') parts.push(segment)
  }
  for (const segment of currentPath.split('/')) {
    if (!segment || segment === '.') continue
    if (segment === '..') {
      parts.pop()
      continue
    }
    parts.push(segment)
  }
  return '/' + parts.join('/')
}

/**
 * Shortens the two roots the user actually navigates by, and leaves everything
 * else alone.
 *
 * On disk a normal user's paths carry their own name and the internal layout:
 * `/workspace/users/aasim/workspace/repos/RelayAB`. The admin sees
 * `/workspace/repos/RelayAB`. So the same project is spelled two different
 * ways depending on who is looking, and the header is long enough to push the
 * rest of the toolbar off a phone. Mapping both onto `/workspace/` makes the
 * view identical for both, and keeps the account name out of the interface.
 *
 * `/workspace/users/<name>/setting/assistant` becomes `/assistant/`.
 *
 * **Display only.** Nothing here changes what is requested, written, or
 * opened - the real path is still what every API call needs, and the tools
 * that act on a path were not touched. Matching is done on path segments
 * rather than by string replacement so `/workspace/users/aasim/workspaceX`
 * and any path that merely contains the word are not rewritten.
 */
export function toDisplayPath(rawPath: string): string {
  if (!rawPath || rawPath === '/') return '/'
  const segments = rawPath.split('/').filter(Boolean)
  if (segments.length === 0) return '/'

  // The admin's browse root is the base itself, so it never matches the
  // `users/<name>/` pattern below and would otherwise be left as a bare
  // `/workspace` with no trailing slash to mark it as the root.
  if (segments.length === 1 && segments[0] === BASE) return `/${BASE}/`

  // The assistant directory is matched on `setting/assistant` rather than on
  // the bare word, so `/workspace/repos/assistant` - the Assistant project
  // itself, a different thing entirely - is left as it is.
  for (let i = 0; i + 1 < segments.length; i++) {
    if (segments[i] === SETTING && segments[i + 1] === ASSISTANT) {
      return withRoot(ASSISTANT, segments.slice(i + 2))
    }
  }

  // The layout is `<base>/users/<name>/workspace`, so the segment before
  // `workspace` is the account name, not `users` itself. Requiring the base to
  // be `workspace` keeps `/opt/users/aasim/workspace` from being rewritten -
  // there is no such layout, and this is display code, so matching it would
  // mean showing a path that does not exist.
  for (let i = 2; i < segments.length; i++) {
    if (
      segments[0] === BASE &&
      segments[i] === WORKSPACE &&
      segments[i - 2] === USERS
    ) {
      return withRoot(WORKSPACE, segments.slice(i + 1))
    }
  }

  return '/' + segments.join('/')
}

function withRoot(root: string, rest: string[]): string {
  // A trailing slash marks the root, so `/workspace/` reads as "you are at the
  // workspace" and `/workspace/repos` reads as "you are inside it".
  return rest.length > 0 ? `/${root}/${rest.join('/')}` : `/${root}/`
}
