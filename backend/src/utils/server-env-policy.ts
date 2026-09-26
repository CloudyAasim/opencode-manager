import { ENV } from '@opencode-manager/shared/config/env'

/**
 * Server environment variables are injected into the OpenCode server process,
 * so editing them is effectively code execution. In production they are locked
 * to administrators unless OCM_ALLOW_SERVER_ENV_EDIT=true is set explicitly.
 */
export function canEditServerEnv(role: string | undefined): boolean {
  if (ENV.SERVER.ALLOW_ENV_EDIT) return true
  return role === 'admin'
}
