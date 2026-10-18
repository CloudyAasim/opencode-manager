import { Hono } from 'hono'
import type { Database } from 'bun:sqlite'
import { CredentialProvider } from '../../services/credential-provider'
import { internalUserOf } from '../../auth/internal-token-middleware'

export function createInternalGitCredentialsRoutes(db: Database) {
  const app = new Hono()

  /**
   * `userId` is passed first and the caller has to be placed on a person
   * before any of this runs, because `getGhCliEnv` answers with a GitHub token
   * **in plaintext** - it is the environment `gh` runs in.
   *
   * Two ways this leaked, both from the same omission:
   *
   *   - with no `userId`, `settingsOwnerId` fell back to `'default'`, the
   *     server-global namespace, so any token holder read it;
   *   - and `?cwd=` resolves a repository through `getRepoByDirectory`, which
   *     lists every repository without an owner filter - so naming another
   *     tenant's directory selected *their* namespace. Passing the caller's id
   *     takes precedence over the resolved repository, which closes that too.
   */
  app.get('/gh-env', (c) => {
    const userId = internalUserOf(c)?.id
    if (!userId) {
      return c.json({ error: 'Unauthorized' }, 401)
    }
    const provider = new CredentialProvider(db)
    return c.json(provider.getGhCliEnv({ cwd: c.req.query('cwd'), userId }))
  })

  return app
}
