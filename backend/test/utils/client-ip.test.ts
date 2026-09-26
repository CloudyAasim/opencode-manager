import { describe, it, expect, vi, beforeEach } from 'vitest'
import { getTrustedClientIp } from '../../src/utils/client-ip'

const { ENV } = vi.hoisted(() => ({
  ENV: {
    AUTH: { TRUST_PROXY: true },
  },
}))

vi.mock('@opencode-manager/shared/config/env', () => ({ ENV }))

describe('getTrustedClientIp', () => {
  beforeEach(() => {
    ENV.AUTH.TRUST_PROXY = true
  })

  it('returns null when the proxy is not trusted', () => {
    ENV.AUTH.TRUST_PROXY = false
    const headers = new Headers({ 'x-real-ip': '203.0.113.7' })

    expect(getTrustedClientIp(headers)).toBeNull()
  })

  it('prefers x-real-ip over a client-supplied x-forwarded-for', () => {
    const headers = new Headers({
      'x-real-ip': '203.0.113.7',
      'x-forwarded-for': '10.0.0.1, 203.0.113.7',
    })

    expect(getTrustedClientIp(headers)).toBe('203.0.113.7')
  })

  it('falls back to the first x-forwarded-for entry', () => {
    const headers = new Headers({ 'x-forwarded-for': '198.51.100.9, 10.0.0.1' })

    expect(getTrustedClientIp(headers)).toBe('198.51.100.9')
  })

  it('supports cf-connecting-ip', () => {
    const headers = new Headers({ 'cf-connecting-ip': '192.0.2.5' })

    expect(getTrustedClientIp(headers)).toBe('192.0.2.5')
  })

  it('returns null when no forwarding header is present', () => {
    expect(getTrustedClientIp(new Headers())).toBeNull()
  })
})
