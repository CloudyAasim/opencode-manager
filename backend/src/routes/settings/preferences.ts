import { Hono } from 'hono'
import { z } from 'zod'
import { randomUUID } from 'crypto'
import { createOpenCodeConfigRoutes } from '../opencode-config'
import type { GitCredential } from '@opencode-manager/shared'
import { logger } from '../../utils/logger'
import { ValidationError } from '../../utils/errors'
import { canEditServerEnv } from '../../utils/server-env-policy'
import { opencodeServerManager } from '../../services/opencode-single-server'
import { validateSSHPrivateKey } from '../../utils/ssh-validation'
import { encryptSecret } from '../../utils/crypto'
import type { SettingsRouteContext } from './context'
import { UpdateSettingsSchema } from '@opencode-manager/shared/schemas'

export function createPreferencesRoutes(ctx: SettingsRouteContext) {
  const { openCodeClient, settingsService, currentUserId } = ctx
  const app = new Hono()
  app.get('/', async (c) => {
    try {
      const userId = currentUserId(c)
      const settings = settingsService.getSettings(userId)
      return c.json(settings)
    } catch (error) {
      logger.error('Failed to get settings:', error)
      return c.json({ error: 'Failed to get settings' }, 500)
    }
  })

  app.patch('/', async (c) => {
    try {
      const userId = currentUserId(c)
      const body = await c.req.json()
      const validated = UpdateSettingsSchema.parse(body)

      const touchesServerEnv =
        validated.preferences.serverEnvVars !== undefined ||
        validated.preferences.disabledDefaultServerEnvVars !== undefined
      if (touchesServerEnv) {
        const user = (c as unknown as { get: (key: string) => { role?: string } | undefined }).get('user')
        if (!canEditServerEnv(user?.role)) {
          logger.warn('Blocked server environment variable edit: disabled for non-admins')
          return c.json({ error: 'SERVER_ENV_EDIT_DISABLED' }, 403)
        }
      }

      if (validated.preferences.gitCredentials) {
        const validations = await Promise.all(
          validated.preferences.gitCredentials.map(async (cred: GitCredential) => {
            if (cred.type === 'ssh' && cred.sshPrivateKey) {
              const validation = await validateSSHPrivateKey(cred.sshPrivateKey)
              if (!validation.valid) {
                throw new ValidationError(`Invalid SSH key for credential '${cred.name}': ${validation.error}`)
              }

              const result: GitCredential = {
                ...cred,
                id: cred.id || randomUUID(),
                sshPrivateKeyEncrypted: encryptSecret(cred.sshPrivateKey),
                hasPassphrase: validation.hasPassphrase,
                passphrase: cred.passphrase ? encryptSecret(cred.passphrase) : undefined,
              }
              delete result.sshPrivateKey
              return result
            }
            return { ...cred, id: cred.id || randomUUID() }
          })
        )
        validated.preferences.gitCredentials = validations
        if (validated.preferences.defaultGitCredentialId && !validations.some((cred) => cred.id === validated.preferences.defaultGitCredentialId)) {
          validated.preferences.defaultGitCredentialId = undefined
        }
      }

      const currentSettings = settingsService.getSettings(userId)

      const settings = settingsService.updateSettings(validated.preferences, userId)

      const credentialsChanged = validated.preferences.gitCredentials !== undefined &&
        JSON.stringify(currentSettings.preferences.gitCredentials || []) !== JSON.stringify(validated.preferences.gitCredentials)

      const identityChanged = validated.preferences.gitIdentity !== undefined &&
        JSON.stringify(currentSettings.preferences.gitIdentity || {}) !== JSON.stringify(validated.preferences.gitIdentity)

      const restartReasons = [
        credentialsChanged && 'git credentials',
        identityChanged && 'git identity',
      ].filter((reason): reason is string => typeof reason === 'string')

      const restartRequired = restartReasons.length > 0
      if (restartRequired) {
        logger.info(`${restartReasons.join(', ')} changed, marking OpenCode server restart as pending`)
        opencodeServerManager.markRestartPending()
      }

      return c.json(restartRequired ? { ...settings, restartRequired: true } : settings)
    } catch (error) {
      logger.error('Failed to update settings:', error)
      if (error instanceof Error && error.message.startsWith('Invalid SSH key')) {
        return c.json({ error: error.message }, 400)
      }
      if (error instanceof z.ZodError) {
        return c.json({ error: 'Invalid settings data', details: error.issues }, 400)
      }
      return c.json({ error: 'Failed to update settings' }, 500)
    }
  })

  app.delete('/', async (c) => {
    try {
      const userId = currentUserId(c)
      const settings = settingsService.resetSettings(userId)
      return c.json(settings)
    } catch (error) {
      logger.error('Failed to reset settings:', error)
      return c.json({ error: 'Failed to reset settings' }, 500)
    }
  })

  app.route('/opencode-config', createOpenCodeConfigRoutes(settingsService, openCodeClient, ctx.db))

  return app
}
