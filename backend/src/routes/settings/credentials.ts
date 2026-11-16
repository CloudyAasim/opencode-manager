import { Hono } from 'hono'
import { z } from 'zod'
import { logger } from '../../utils/logger'
import { spawnWithTimeout } from '../../utils/process'
import { validateSSHPrivateKey } from '../../utils/ssh-validation'
import { TestSSHConnectionSchema } from '@opencode-manager/shared/schemas'

export function createCredentialsRoutes() {
  const app = new Hono()

  app.post('/test-ssh', async (c) => {
    try {
      const body = await c.req.json()
      const { host, sshPrivateKey, passphrase } = TestSSHConnectionSchema.parse(body)

      logger.info(`Testing SSH connection to ${host}`)

      const validation = await validateSSHPrivateKey(sshPrivateKey)
      if (!validation.valid) {
        return c.json({
          success: false,
          message: validation.error || 'Invalid SSH key'
        }, 400)
      }

      const { writeTemporarySSHKey, cleanupSSHKey, parseSSHHost } = await import('../../utils/ssh-key-manager')

      let keyPath: string | null = null
      try {
        keyPath = await writeTemporarySSHKey(sshPrivateKey, 'test')

        const { user, host: sshHost, port } = parseSSHHost(host)

        const sshArgs = [
          '-T',
          '-v',
          '-i', keyPath,
          '-o', 'IdentitiesOnly=yes',
          '-o', 'PasswordAuthentication=no',
          '-o', 'StrictHostKeyChecking=accept-new',
          '-o', 'UserKnownHostsFile=/dev/null',
        ]

        if (port && port !== '22') {
          sshArgs.push('-p', port)
        }

        sshArgs.push(`${user}@${sshHost}`)

        let executable = 'ssh'
        const env: Record<string, string> = {}
        if (passphrase) {
          executable = 'sshpass'
          sshArgs.unshift('-e', 'ssh')
          env.SSHPASS = passphrase
        }

        const { output, timedOut } = spawnWithTimeout([executable, ...sshArgs], 30000, env)

        if (timedOut) {
          logger.warn(`SSH connection test to ${host} timed out`)
          return c.json({
            success: false,
            message: 'Connection timed out. This may indicate a network issue or an incorrect host.'
          })
        }

        const outputStr = String(output)

        if (outputStr.includes('Permission denied') || outputStr.includes('Access denied')) {
          return c.json({
            success: false,
            message: 'Permission denied. The SSH key may not be authorized on this host, or the passphrase is incorrect.'
          })
        }

        if (outputStr.includes('Could not resolve hostname') || outputStr.includes('Name or service not known')) {
          return c.json({
            success: false,
            message: 'Could not resolve hostname. Please check that the host is correct and accessible.'
          })
        }

        if (outputStr.includes('Connection refused') || outputStr.includes('Connection timed out')) {
          return c.json({
            success: false,
            message: 'Connection refused or timed out. The host may be down or not accepting SSH connections.'
          })
        }

        const authenticated = outputStr.includes('successfully authenticated') ||
                              outputStr.includes('You\'ve successfully authenticated') ||
                              outputStr.includes('Welcome to') ||
                              outputStr.includes('Authenticated to')

        if (authenticated) {
          logger.info(`SSH connection test to ${host} succeeded`)
          return c.json({
            success: true,
            message: `Successfully connected to ${host}`
          })
        }

        logger.warn(`SSH connection test to ${host} returned ambiguous output: ${outputStr}`)
        return c.json({
          success: false,
          message: `Authentication failed. The key may not be authorized on this host. Details: ${outputStr.trim().substring(0, 200)}`
        })

      } finally {
        if (keyPath) {
          await cleanupSSHKey(keyPath)
        }
      }
    } catch (error) {
      logger.error('Failed to test SSH connection:', error)
      if (error instanceof z.ZodError) {
        return c.json({ error: 'Invalid request data', details: error.issues }, 400)
      }
      return c.json({
        success: false,
        message: error instanceof Error ? error.message : 'Failed to test SSH connection'
      }, 500)
    }
  })

  return app
}
