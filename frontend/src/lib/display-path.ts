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

/**
 * Shortens the two roots the user actually navigates by, and leaves everything
 * else alone.
 *
 * On disk a normal user's paths carry their own name and the internal layout:
 * `/workspace/users/aasim/workspace/repos/RelayAB`. The admin sees
 * `/workspace/repos/RelayAB`. So the same project is spelled two different
 * ways depending on who is looking, and the header is long enough to push the
 * rest of the toolbar off a phone. Mapping both onto `/workspace` makes the
 * view identical for both, and keeps the account name out of the interface.
 *
 * `/workspace/users/<name>/setting/assistant` becomes `/assistant`.
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
      segments[0] === WORKSPACE &&
      segments[i] === WORKSPACE &&
      segments[i - 2] === USERS
    ) {
      return withRoot(WORKSPACE, segments.slice(i + 1))
    }
  }

  return '/' + segments.join('/')
}

function withRoot(root: string, rest: string[]): string {
  return rest.length > 0 ? `/${root}/${rest.join('/')}` : `/${root}`
}
