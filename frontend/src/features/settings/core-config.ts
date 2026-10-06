/**
 * Reading and patching the top-level OpenCode configuration keys that no
 * structured editor covered until now.
 *
 * Two rules run through everything here.
 *
 * **Only the keys we show are touched.** A settings page that rewrites a
 * document it does not fully understand will delete whatever it did not
 * recognise - a key a newer OpenCode added, a typo the user was about to fix,
 * an entry they manage by hand in the JSON editor. Every reader returns the
 * known slice; every writer spreads the untouched original underneath.
 *
 * **The merge is what OpenCode actually does.** `provider`, `agent`, `mcp`
 * and friends are deep-merged across layers, so a tenant's project config
 * overrides only the leaves it actually defines. That is why a divergence is
 * worth reporting per field, and why clearing one is `delete`, not `{}`.
 */

export type OpenCodeConfigContent = Record<string, unknown>

/**
 * The tools whose permission this page can set. Anything else in the
 * document is left exactly where it is.
 */
export const PERMISSION_TOOLS = [
  'read',
  'write',
  'edit',
  'bash',
  'glob',
  'grep',
  'list',
  'patch',
  'todowrite',
  'todoread',
  'webfetch',
  'websearch',
] as const

export type PermissionTool = (typeof PERMISSION_TOOLS)[number]

export const PERMISSION_DECISIONS = ['allow', 'ask', 'deny'] as const

export type PermissionDecision = (typeof PERMISSION_DECISIONS)[number]

export type PermissionDecisions = Partial<Record<PermissionTool, PermissionDecision>>

/**
 * Select cannot express "this key is absent" with an empty string - Radix
 * reads that as "clear the selection" and refuses the item outright. An unset
 * key is a real and common state: it means OpenCode's own default applies,
 * which is not the same as `allow`, and not the same as `false`.
 */
export const UNSET = 'unset'

export type Choice = PermissionDecision | typeof UNSET

export type CompactionSettings = {
  auto?: boolean
  prune?: boolean
}

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

export function asString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

export function asBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined
}

export function asStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((entry): entry is string => typeof entry === 'string')
}

/**
 * A textarea is one entry per line. Blank lines are dropped rather than
 * becoming empty strings, which OpenCode would try to load.
 */
export function parseLineList(text: string): string[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
}

export function readPermission(value: unknown): PermissionDecisions {
  const source = asObject(value)
  const decisions: PermissionDecisions = {}
  for (const tool of PERMISSION_TOOLS) {
    const decision = source[tool]
    if (decision === 'allow' || decision === 'ask' || decision === 'deny') {
      decisions[tool] = decision
    }
  }
  return decisions
}

export function isPermissionDecision(value: string): value is PermissionDecision {
  return (PERMISSION_DECISIONS as readonly string[]).includes(value)
}

/**
 * Merges the shown tools back into whatever was there. A tool that ends up
 * unset is removed rather than written as `null`, so OpenCode applies its own
 * default instead of failing to parse the value.
 */
export function withPermissionDecisions(current: unknown, decisions: PermissionDecisions): Record<string, unknown> {
  const next = { ...asObject(current) }
  for (const tool of PERMISSION_TOOLS) {
    const decision = decisions[tool]
    if (decision === undefined) {
      delete next[tool]
    } else {
      next[tool] = decision
    }
  }
  return next
}

export function readCompaction(value: unknown): CompactionSettings {
  const source = asObject(value)
  return {
    auto: asBoolean(source.auto),
    prune: asBoolean(source.prune),
  }
}

export function withCompaction(current: unknown, settings: CompactionSettings): Record<string, unknown> {
  const next = { ...asObject(current) }
  for (const key of ['auto', 'prune'] as const) {
    const value = settings[key]
    if (value === undefined) {
      delete next[key]
    } else {
      next[key] = value
    }
  }
  return next
}

/**
 * Applies a patch to the document, where `undefined` means "remove this key".
 *
 * Deleting rather than writing `null` is the whole point: a cleared input is
 * the user saying "I have no opinion about this any more", and the only way
 * to say that to a deep-merging loader is to stop defining the key.
 */
export function applyPatch(
  content: OpenCodeConfigContent,
  patch: Record<string, unknown>,
): OpenCodeConfigContent {
  const next: OpenCodeConfigContent = { ...content }
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) {
      delete next[key]
    } else {
      next[key] = value
    }
  }
  return next
}

/**
 * An empty text field clears the key instead of writing an empty string.
 * Kept next to `applyPatch` so the two cannot drift apart.
 */
export function stringOrUnset(value: string): string | undefined {
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

/**
 * Wraps a merged section for the patch.
 *
 * Clearing the last field of `compaction` has to remove the whole key: an
 * empty `compaction: {}` is not the same thing as no `compaction`, and leaving
 * one behind means a document that grew a section nobody asked for.
 */
export function sectionPatch(key: string, merged: Record<string, unknown>): Record<string, unknown> {
  return Object.keys(merged).length > 0 ? { [key]: merged } : { [key]: undefined }
}