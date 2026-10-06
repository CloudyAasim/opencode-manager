import { createHash } from 'node:crypto'
import type { Database } from 'bun:sqlite'
import { readOpenCodeConfigFile } from './opencode-config-file'

/**
 * A provider id that exists both in the server-wide configuration and in one
 * tenant's own declaration.
 *
 * This is reported, never resolved on the tenant's behalf. OpenCode merges a
 * project configuration over the global one, so the tenant's own copy is the
 * one already in effect - but "already in effect" is exactly the kind of thing
 * a person should be told about rather than left to infer, especially when the
 * two definitions disagree about where requests go.
 */
export interface ProviderConflict {
  providerId: string
  /** The administrator's entry, so the tenant can see what they are being asked about. */
  globalEntry: unknown
  /** The tenant's own entry, which is the one in effect until they decide. */
  userEntry: unknown
  /** True when this tenant has already said they are keeping theirs. */
  acknowledged: boolean
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

/**
 * A stable digest of one global provider entry.
 *
 * Recorded when a tenant acknowledges a conflict, so that the acknowledgement
 * applies to the definition they were actually shown. Without it, an
 * administrator could repoint the same id at a different endpoint months later
 * and the tenant who had already acknowledged the first one would never be told.
 *
 * Keys are sorted before hashing. The entry comes back out of a JSONC file that
 * the config editor rewrites, and a rewrite that merely reorders keys produces
 * a byte-different document describing the same provider. Hashing the raw text
 * would raise the prompt again for a change nobody made.
 */
export function fingerprintProviderEntry(entry: unknown): string {
  return createHash('sha256').update(JSON.stringify(canonicalize(entry)) ?? 'null').digest('hex').slice(0, 32)
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (value && typeof value === 'object') {
    const source = value as Record<string, unknown>
    return Object.fromEntries(
      Object.keys(source).sort().map((key) => [key, canonicalize(source[key])]),
    )
  }
  return value
}

/**
 * Which of this tenant's declared ids collide with the global configuration.
 *
 * Read from disk rather than from a cached list, because the global side is
 * written by a different request - possibly a different person's - and a
 * conflict that only appears after a page reload is a conflict nobody acted on.
 */
export async function listProviderConflicts(
  username: string,
  ownDeclarations: Record<string, unknown>,
): Promise<ProviderConflict[]> {
  const global = asRecord((await readOpenCodeConfigFile())?.content?.provider)
  const ids = Object.keys(ownDeclarations)
    .filter((id) => id in global)
    .sort()

  return ids.map((providerId) => ({
    providerId,
    globalEntry: global[providerId],
    userEntry: ownDeclarations[providerId],
    acknowledged: false,
  }))
}

export function withAcknowledgements(
  db: Database,
  username: string,
  conflicts: ProviderConflict[],
): ProviderConflict[] {
  return conflicts.map((conflict) => {
    const row = db
      .prepare('SELECT global_fingerprint FROM provider_conflict_ack WHERE username = ? AND provider_id = ?')
      .get(username, conflict.providerId) as { global_fingerprint: string } | undefined

    return {
      ...conflict,
      // Acknowledged only against the exact entry that was on screen. A global
      // definition that has since changed is a new thing to be told about, so a
      // stale acknowledgement does not count.
      acknowledged: row
        ? row.global_fingerprint === fingerprintProviderEntry(conflict.globalEntry)
        : false,
    }
  })
}

export function acknowledgeProviderConflict(
  db: Database,
  username: string,
  providerId: string,
  globalEntry: unknown,
): void {
  db.prepare(
    `INSERT INTO provider_conflict_ack (username, provider_id, global_fingerprint, created_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(username, provider_id) DO UPDATE
       SET global_fingerprint = excluded.global_fingerprint,
           created_at = excluded.created_at`,
  ).run(username, providerId, fingerprintProviderEntry(globalEntry), Date.now())
}

export function clearProviderConflictAcknowledgement(
  db: Database,
  username: string,
  providerId: string,
): void {
  db.prepare('DELETE FROM provider_conflict_ack WHERE username = ? AND provider_id = ?')
    .run(username, providerId)
}

/**
 * Acknowledgements that no longer describe anything.
 *
 * A tenant's own declaration is what makes a conflict exist, so removing the
 * declaration ends it - and leaving the acknowledgement behind would mean that
 * if they later declare the same id again, the prompt is already answered for a
 * definition they have never seen.
 */
export function forgetProviderConflictAcksForMissingDeclarations(
  db: Database,
  username: string,
  declaredIds: readonly string[],
): void {
  const rows = db
    .prepare('SELECT provider_id FROM provider_conflict_ack WHERE username = ?')
    .all(username) as Array<{ provider_id: string }>
  const declared = new Set(declaredIds)
  for (const row of rows) {
    if (!declared.has(row.provider_id)) {
      clearProviderConflictAcknowledgement(db, username, row.provider_id)
    }
  }
}
