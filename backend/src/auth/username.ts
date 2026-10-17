import { deriveUsernameFromEmail, uniquifyUsername } from '@opencode-manager/shared/utils'

interface SqliteLike {
  prepare(sql: string): { all(...params: unknown[]): unknown[] }
}

/**
 * Gives a pending account its username, mutating the object better-auth is
 * about to insert.
 *
 * The derivation itself lives in `@opencode-manager/shared/utils/username`,
 * alongside the one the admin user service uses. It used to be copied here -
 * a second implementation of the same rules - which is how the same email ends
 * up with different usernames depending on which path created the account.
 * They happened to agree on every input tried, which is exactly the kind of
 * agreement that lasts only until one side is edited.
 *
 * Split out of the `create.before` hook rather than inlined there, so it can
 * be tested directly: better-auth's sign-up cannot run under this project's
 * vitest setup, because its Kysely adapter calls `db.transaction` on a dialect
 * config the `bun:sqlite` shim does not satisfy.
 */
export function applyUsernameToNewUser(
  db: SqliteLike,
  user: { email?: unknown; id?: unknown; username?: unknown },
): string {
  const taken = new Set(
    (db.prepare('SELECT username FROM "user" WHERE username IS NOT NULL').all() as { username: string }[])
      .map((row) => row.username?.trim().toLowerCase())
      .filter((value): value is string => Boolean(value)),
  )
  const email = typeof user.email === 'string' ? user.email : undefined
  const username = uniquifyUsername(deriveUsernameFromEmail(email ?? String(user.id ?? '')), (c) => taken.has(c))
  Object.assign(user, { username })
  return username
}
