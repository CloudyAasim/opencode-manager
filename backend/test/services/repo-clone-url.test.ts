import { describe, it, expect } from 'vitest'
import { normalizeRepoUrl, redactRepoUrlCredentials } from '../../src/services/repo/clone'

/**
 * Cloning a private repository with the token in the URL is ordinary practice,
 * and `normalizeRepoUrl` passes such URLs through untouched - which is what the
 * `git` call needs, since a user relying on it would otherwise fail to clone.
 *
 * So the split that matters is: the token reaches git, and reaches nothing else.
 * It used to reach the `repos` table, the logs, every clone error message and
 * the repo listings shown to the owner and to admins.
 */
describe('redactRepoUrlCredentials', () => {
  it('strips username and password from an http(s) URL', () => {
    expect(redactRepoUrlCredentials('https://alice:ghp_SECRET123@github.com/org/repo.git'))
      .toBe('https://github.com/org/repo.git')
  })

  it('strips a username with no password', () => {
    expect(redactRepoUrlCredentials('https://alice@github.com/org/repo'))
      .toBe('https://github.com/org/repo')
  })

  it('leaves a credential-free URL untouched', () => {
    expect(redactRepoUrlCredentials('https://github.com/org/repo'))
      .toBe('https://github.com/org/repo')
  })

  it('leaves scp-style SSH remotes untouched', () => {
    // `git@github.com:org/repo` has no `://`, so there is no userinfo to strip,
    // and the `git@` is part of the address rather than a credential.
    expect(redactRepoUrlCredentials('git@github.com:org/repo.git'))
      .toBe('git@github.com:org/repo.git')
  })

  it('strips userinfo from an ssh:// URL', () => {
    expect(redactRepoUrlCredentials('ssh://git@github.com/org/repo.git'))
      .toBe('ssh://github.com/org/repo.git')
  })

  it('does not treat a path segment containing @ as credentials', () => {
    expect(redactRepoUrlCredentials('https://github.com/org/repo@v1'))
      .toBe('https://github.com/org/repo@v1')
  })
})

describe('clone URL handling', () => {
  it('keeps the token for git but not for storage', () => {
    const raw = 'https://alice:ghp_SECRET123@github.com/org/private-repo.git'

    // What `normalizeRepoUrl` hands to `git` - the credential has to survive.
    const normalized = normalizeRepoUrl(raw, false).url
    expect(normalized).toContain('ghp_SECRET123')

    // What gets persisted and displayed - it must not.
    const stored = redactRepoUrlCredentials(normalized)
    expect(stored).toBe('https://github.com/org/private-repo')
    expect(stored).not.toContain('ghp_SECRET123')
  })

  it('redacts credentials for any host, not just GitHub', () => {
    const stored = redactRepoUrlCredentials(normalizeRepoUrl('http://bob:hunter2@gitlab.com/g/sub/p.git', false).url)
    expect(stored).toBe('https://gitlab.com/g/sub/p')
    expect(stored).not.toContain('hunter2')
  })

  it('leaves an ordinary public clone untouched end to end', () => {
    const normalized = normalizeRepoUrl('https://github.com/org/repo.git', false).url
    expect(redactRepoUrlCredentials(normalized)).toBe('https://github.com/org/repo')
  })
})
