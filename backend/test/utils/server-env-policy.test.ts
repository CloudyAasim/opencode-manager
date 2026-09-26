import { describe, it, expect, vi, beforeEach } from 'vitest'
import { canEditServerEnv } from '../../src/utils/server-env-policy'

const { ENV } = vi.hoisted(() => ({
  ENV: {
    SERVER: { ALLOW_ENV_EDIT: false },
  },
}))

vi.mock('@opencode-manager/shared/config/env', () => ({ ENV }))

describe('canEditServerEnv', () => {
  beforeEach(() => {
    ENV.SERVER.ALLOW_ENV_EDIT = false
  })

  it('locks server env edits to administrators when disabled', () => {
    expect(canEditServerEnv('admin')).toBe(true)
    expect(canEditServerEnv('user')).toBe(false)
    expect(canEditServerEnv(undefined)).toBe(false)
  })

  it('allows everyone when explicitly enabled', () => {
    ENV.SERVER.ALLOW_ENV_EDIT = true
    expect(canEditServerEnv('user')).toBe(true)
    expect(canEditServerEnv(undefined)).toBe(true)
  })
})
