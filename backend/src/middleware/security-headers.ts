import { createMiddleware } from 'hono/factory'
import { ENV } from '@opencode-manager/shared/config/env'

const PERMISSIONS_POLICY = [
  'accelerometer=()',
  'camera=()',
  'geolocation=()',
  'gyroscope=()',
  'magnetometer=()',
  'microphone=(self)',
  'payment=()',
  'usb=()',
].join(', ')

export function createSecurityHeadersMiddleware() {
  return createMiddleware(async (c, next) => {
    await next()

    const headers = c.res.headers
    headers.set('X-Content-Type-Options', 'nosniff')
    headers.set('X-Frame-Options', 'DENY')
    headers.set('Referrer-Policy', 'strict-origin-when-cross-origin')
    headers.set('Permissions-Policy', PERMISSIONS_POLICY)
    headers.set('Cross-Origin-Opener-Policy', 'same-origin')
    headers.set('X-DNS-Prefetch-Control', 'off')

    if (ENV.SECURITY.HSTS) {
      headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains')
    }

    if (ENV.SECURITY.CSP) {
      headers.set('Content-Security-Policy', ENV.SECURITY.CSP)
    }
  })
}
