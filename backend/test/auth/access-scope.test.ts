import { describe, it, expect } from 'vitest'
import path from 'node:path'
import { isWithinRoots } from '../../src/auth/access-scope'

describe('isWithinRoots', () => {
  const root = '/workspace/users/alice'

  it('accepts the root itself and descendants', () => {
    expect(isWithinRoots(root, [root])).toBe(true)
    expect(isWithinRoots(path.join(root, 'repo', 'src', 'index.ts'), [root])).toBe(true)
  })

  it('rejects siblings, parents and unrelated paths', () => {
    expect(isWithinRoots('/workspace/users/bob', [root])).toBe(false)
    expect(isWithinRoots('/workspace/users', [root])).toBe(false)
    expect(isWithinRoots('/etc/passwd', [root])).toBe(false)
  })

  it('rejects everything when no roots are configured', () => {
    expect(isWithinRoots(root, [])).toBe(false)
  })

  it('accepts a path contained in any of several roots', () => {
    expect(isWithinRoots('/srv/repos/alice-x/src', ['/workspace/users/alice', '/srv/repos/alice-x'])).toBe(true)
  })
})
