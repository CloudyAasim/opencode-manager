/**
 * The file browser hands back a path that is relative to the repository, while
 * a mention inside the prompt is relative to the folder the user is actually
 * working in. Same file, two shapes - the prompt only ever wants the second
 * one, and getting it wrong silently mentions a path that does not exist.
 */
export function toPromptMentionPath(
  path: string,
  basePath: string | null | undefined,
): string {
  if (!basePath) return path

  const normalizedPath = path.replace(/^\.\//, '')
  const normalizedBasePath = basePath.replace(/^\.\//, '').replace(/\/+$/, '')
  const basePrefix = `${normalizedBasePath}/`

  return normalizedPath.startsWith(basePrefix)
    ? normalizedPath.slice(basePrefix.length)
    : normalizedPath
}
