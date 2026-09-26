import { ENV } from '@opencode-manager/shared/config/env'

/**
 * Headers that a trusted reverse proxy is expected to set to the real client
 * address. `x-real-ip` is preferred because Caddy (and most proxies) overwrite
 * it with the direct peer, whereas `x-forwarded-for` may be appended to a
 * client-supplied value. Only consulted when AUTH_TRUST_PROXY=true.
 */
const TRUSTED_IP_HEADERS = ['x-real-ip', 'cf-connecting-ip', 'x-forwarded-for'] as const

type HeaderReader = {
  get(name: string): string | null | undefined
}

export function getTrustedClientIp(headers: HeaderReader): string | null {
  if (!ENV.AUTH.TRUST_PROXY) return null

  for (const name of TRUSTED_IP_HEADERS) {
    const raw = headers.get(name)
    if (!raw) continue

    const value = name === 'x-forwarded-for'
      ? raw.split(',')[0]?.trim()
      : raw.trim()

    if (value) return value
  }

  return null
}
