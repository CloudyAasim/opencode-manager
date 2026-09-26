import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Hono } from 'hono'
import { createSecurityHeadersMiddleware } from '../../src/middleware/security-headers'

const { ENV } = vi.hoisted(() => ({
  ENV: {
    SECURITY: {
      HSTS: true,
      CSP: "default-src 'self'",
    },
  },
}))

vi.mock('@opencode-manager/shared/config/env', () => ({ ENV }))

function createApp() {
  const app = new Hono()
  app.use('/*', createSecurityHeadersMiddleware())
  app.get('/ping', (c) => c.json({ ok: true }))
  return app
}

describe('createSecurityHeadersMiddleware', () => {
  beforeEach(() => {
    ENV.SECURITY.HSTS = true
    ENV.SECURITY.CSP = "default-src 'self'"
  })

  it('applies baseline hardening headers', async () => {
    const res = await createApp().request('/ping')

    expect(res.headers.get('x-content-type-options')).toBe('nosniff')
    expect(res.headers.get('x-frame-options')).toBe('DENY')
    expect(res.headers.get('referrer-policy')).toBe('strict-origin-when-cross-origin')
    expect(res.headers.get('cross-origin-opener-policy')).toBe('same-origin')
    expect(res.headers.get('permissions-policy')).toContain('camera=()')
  })

  it('adds HSTS and CSP when enabled', async () => {
    const res = await createApp().request('/ping')

    expect(res.headers.get('strict-transport-security')).toContain('max-age=31536000')
    expect(res.headers.get('content-security-policy')).toBe("default-src 'self'")
  })

  it('omits HSTS and CSP when disabled', async () => {
    ENV.SECURITY.HSTS = false
    ENV.SECURITY.CSP = ''

    const res = await createApp().request('/ping')

    expect(res.headers.get('strict-transport-security')).toBeNull()
    expect(res.headers.get('content-security-policy')).toBeNull()
  })
})
