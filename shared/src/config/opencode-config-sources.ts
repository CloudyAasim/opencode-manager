import { OPENCODE_CONFIG_SOURCE_NAMES, type OpenCodeConfigSourceName } from './defaults'

export const DEFAULT_OPENCODE_CONFIG_SOURCE_NAME: OpenCodeConfigSourceName = 'opencode.jsonc'

export function isOpenCodeConfigSourceName(value: string): value is OpenCodeConfigSourceName {
  return (OPENCODE_CONFIG_SOURCE_NAMES as readonly string[]).includes(value)
}

/**
 * Which of the sources there are is the one that is written to.
 *
 * The names come in as strings and not as the known ones, because the client
 * that holds the document was given the names by the server and does not have
 * the list. A name nobody knows is simply not the preferred one.
 */
export function selectPreferredOpenCodeConfigSourceName(
  names: readonly string[],
): OpenCodeConfigSourceName | null {
  const present = new Set(names)
  for (const name of [...OPENCODE_CONFIG_SOURCE_NAMES].reverse()) {
    if (present.has(name)) return name
  }
  return null
}
