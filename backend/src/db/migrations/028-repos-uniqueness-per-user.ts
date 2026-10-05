import { MigrationDeclinedError, type Migration } from '../migration-runner'

/**
 * `repos.local_path` is a name inside a directory, and `repos.repo_url` belongs
 * to a checkout - neither is a name on the machine.
 *
 * The checkout itself has always been per user: `resolveRepoBase` returns
 * `getUserReposPath(username)`, so two people cloning the same repository get
 * two directories that share nothing. The columns, however, hold only the bare
 * directory name and the bare URL, and the unique indexes built in migration 4
 * treat both as global. So the second person to clone anything the first person
 * already had hit a constraint violation on a collision that could not
 * physically happen, reported as a URL conflict and then as database
 * corruption.
 *
 * Both indexes become two, because there are two populations:
 *
 *  - an owned row only has to be unique within its own user;
 *  - a shared row (`user_id IS NULL`) lives in the global repos directory, so
 *    for those the old global rule was right all along and is kept.
 *
 * `local_path` and `repo_url`+`branch` are changed together on purpose. Scoping
 * only the directory name would leave "two users, same repository, same
 * explicitly chosen branch" still refused by the URL index - the same bug with
 * one fewer step to reproduce, and it would only surface for anyone who
 * bothers to pick a branch.
 */
const migration: Migration = {
  version: 28,
  name: 'repos-uniqueness-per-user',

  up(db) {
    // Migration 4 made both of these globally unique, so duplicates among
    // shared rows cannot exist in a database migrated since. The check is
    // belt-and-braces - and it has to be here, because the alternative to
    // checking is `CREATE UNIQUE INDEX` throwing inside `initializeDatabase`,
    // which takes the server down instead of reporting anything. Refusing to
    // migrate keeps the existing (working) constraints and says why.
    const sharedDuplicates = db
      .prepare(`
        SELECT local_path, COUNT(*) AS n
        FROM repos
        WHERE user_id IS NULL AND local_path IS NOT NULL
        GROUP BY local_path
        HAVING n > 1
      `)
      .all() as { local_path: string; n: number }[]

    const sharedUrlDuplicates = db
      .prepare(`
        SELECT repo_url, branch, COUNT(*) AS n
        FROM repos
        WHERE user_id IS NULL AND branch IS NOT NULL
        GROUP BY repo_url, branch
        HAVING n > 1
      `)
      .all() as { repo_url: string; branch: string; n: number }[]

    if (sharedDuplicates.length > 0 || sharedUrlDuplicates.length > 0) {
      // Declined, not returned. A plain `return` here is indistinguishable from
      // success, so the runner records this migration as applied and it never
      // runs again - leaving the global constraints in place while the
      // database insists the migration that would fix them is done.
      throw new MigrationDeclinedError(
        `Shared repositories already share a key: ` +
        [
          ...sharedDuplicates.map((row) => `local_path '${row.local_path}' (x${row.n})`),
          ...sharedUrlDuplicates.map((row) => `url '${row.repo_url}'#${row.branch} (x${row.n})`),
        ].join(', ') +
        '. The previous global constraints are left in place and are still the ones in force; ' +
        'resolve these rows and restart, and this migration will run again.',
      )
    }

    db.run('DROP INDEX IF EXISTS idx_local_path')
    db.run('DROP INDEX IF EXISTS idx_repo_url_branch')

    db.run(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_local_path
      ON repos(user_id, local_path)
      WHERE user_id IS NOT NULL
    `)
    db.run(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_local_path_shared
      ON repos(local_path)
      WHERE user_id IS NULL
    `)
    db.run(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_repo_url_branch
      ON repos(user_id, repo_url, branch)
      WHERE user_id IS NOT NULL AND branch IS NOT NULL
    `)
    db.run(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_repo_url_branch_shared
      ON repos(repo_url, branch)
      WHERE user_id IS NULL AND branch IS NOT NULL
    `)
  },

  down(db) {
    // Restoring the global indexes fails if two users now share a key, which is
    // the entire point of this migration. That is a real limitation of `down`
    // and not something to paper over: the rows have to be reconciled first.
    const conflicts = db
      .prepare(`
        SELECT local_path, COUNT(DISTINCT user_id) AS owners
        FROM repos
        WHERE user_id IS NOT NULL
        GROUP BY local_path
        HAVING owners > 1
      `)
      .all() as { local_path: string; owners: number }[]

    const urlConflicts = db
      .prepare(`
        SELECT repo_url, branch, COUNT(DISTINCT user_id) AS owners
        FROM repos
        WHERE user_id IS NOT NULL AND branch IS NOT NULL
        GROUP BY repo_url, branch
        HAVING owners > 1
      `)
      .all() as { repo_url: string; branch: string; owners: number }[]

    if (conflicts.length > 0 || urlConflicts.length > 0) {
      throw new Error(
        `Cannot restore the global repos uniqueness indexes: ` +
        [
          ...conflicts.map((row) => `local_path '${row.local_path}' (${row.owners} owners)`),
          ...urlConflicts.map((row) => `url '${row.repo_url}'#${row.branch} (${row.owners} owners)`),
        ].join(', ') +
        ' would collide. Rename them first.',
      )
    }

    db.run('DROP INDEX IF EXISTS idx_local_path')
    db.run('DROP INDEX IF EXISTS idx_local_path_shared')
    db.run('DROP INDEX IF EXISTS idx_repo_url_branch')
    db.run('DROP INDEX IF EXISTS idx_repo_url_branch_shared')
    db.run('CREATE UNIQUE INDEX IF NOT EXISTS idx_local_path ON repos(local_path)')
    db.run('CREATE UNIQUE INDEX IF NOT EXISTS idx_repo_url_branch ON repos(repo_url, branch) WHERE branch IS NOT NULL')
  },
}

export default migration
