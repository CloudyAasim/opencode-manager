import { promises as fs } from 'fs'
import path from 'path'
import { getUserWorkspacePath } from '@opencode-manager/shared/config/env'
import { logger } from '../utils/logger'
import { mkdirSafe } from '../utils/fs-safe'

type ProviderEntry = { options?: Record<string, unknown> } & Record<string, unknown>

function providerConfigPath(username: string): string {
  return path.join(getUserWorkspacePath(username), 'opencode.json')
}

async function readConfig(configPath: string): Promise<Record<string, unknown>> {
  try {
    const raw = await fs.readFile(configPath, 'utf-8')
    return JSON.parse(raw) as Record<string, unknown>
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {}
    logger.error('Failed to read user provider config:', error)
    return {}
  }
}

async function writeConfig(configPath: string, config: Record<string, unknown>): Promise<void> {
  await mkdirSafe(path.dirname(configPath))
  await fs.writeFile(configPath, JSON.stringify(config, null, 2), { mode: 0o600 })
}

function providersOf(config: Record<string, unknown>): Record<string, ProviderEntry> {
  return (config.provider ?? {}) as Record<string, ProviderEntry>
}

/**
 * Provider credentials are stored per user in their own workspace `opencode.json`
 * so one account can never read or overwrite another account's providers.
 */
export class UserProviderService {
  async list(username: string): Promise<string[]> {
    const config = await readConfig(providerConfigPath(username))
    return Object.entries(providersOf(config))
      .filter(([, entry]) => Boolean(entry?.options?.apiKey))
      .map(([providerId]) => providerId)
  }

  async has(username: string, providerId: string): Promise<boolean> {
    return (await this.list(username)).includes(providerId)
  }

  async set(username: string, providerId: string, apiKey: string): Promise<void> {
    const configPath = providerConfigPath(username)
    const config = await readConfig(configPath)
    const providers = { ...providersOf(config) }
    const existing = providers[providerId] ?? {}
    providers[providerId] = {
      ...existing,
      options: { ...(existing.options ?? {}), apiKey },
    }

    await writeConfig(configPath, { ...config, provider: providers })
    logger.info(`Set per-user credentials for provider: ${providerId}`)
  }

  async delete(username: string, providerId: string): Promise<void> {
    const configPath = providerConfigPath(username)
    const config = await readConfig(configPath)
    const providers = { ...providersOf(config) }
    delete providers[providerId]

    await writeConfig(configPath, { ...config, provider: providers })
    logger.info(`Deleted per-user credentials for provider: ${providerId}`)
  }
}
