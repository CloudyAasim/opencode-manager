import { ENV } from '@opencode-manager/shared/config/env'

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
