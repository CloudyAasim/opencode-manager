import { ENV } from '@opencode-manager/shared/config/env'

export function canEditServerEnv(role: string | undefined): boolean {
  if (ENV.SERVER.ALLOW_ENV_EDIT) return true
  return role === 'admin'
}
