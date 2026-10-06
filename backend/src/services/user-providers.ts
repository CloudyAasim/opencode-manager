import { promises as fs } from 'fs'
import path from 'path'
import { getUserSettingPath, getUserWorkspacePath } from '@opencode-manager/shared/config/env'
import { logger } from '../utils/logger'
import { mkdirSafe } from '../utils/fs-safe'

type ProviderEntry = { options?: Record<string, unknown> } & Record<string, unknown>

function settingRoot(username: string): string {
  return getUserSettingPath(username)
}

function reposRoot(username: string): string {
  return path.join(getUserWorkspacePath(username), 'repos')
}

function configPathIn(directory: string): string {
  return path.join(directory, 'opencode.json')
}

async function readConfig(configPath: string): Promise<Record<string, unknown>> {
  try {
    const raw = await fs.readFile(configPath, 'utf-8')
    return JSON.parse(raw) as Record<string, unknown>
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {}
    logger.error('Failed to read provider config:', error)
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

async function listConfigDirectories(username: string): Promise<string[]> {
  const setting = settingRoot(username)
  const directories = [setting, path.join(setting, 'assistant')]
  try {
    const entries = await fs.readdir(reposRoot(username), { withFileTypes: true })
    for (const entry of entries) {
      if (entry.isDirectory()) directories.push(path.join(reposRoot(username), entry.name))
    }
  } catch {
  void 0
  }
  return directories
}

async function upsertProvider(configPath: string, providerId: string, apiKey: string | null): Promise<void> {
  const config = await readConfig(configPath)
  const providers = { ...providersOf(config) }

  if (apiKey === null) {
    if (!(providerId in providers)) return
    const entry = providers[providerId]
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      delete providers[providerId]
    } else {
      const remainingOptions: Record<string, unknown> = { ...((entry.options ?? {}) as Record<string, unknown>) }
      delete remainingOptions.apiKey
      const next: ProviderEntry = { ...entry, options: remainingOptions }
      if (Object.keys(remainingOptions).length === 0) delete next.options
      if (Object.keys(next).length === 0) {
        delete providers[providerId]
      } else {
        providers[providerId] = next
      }
    }
  } else {
    const existing = providers[providerId] ?? {}
    providers[providerId] = { ...existing, options: { ...(existing.options ?? {}), apiKey } }
  }

  await writeConfig(configPath, { ...config, provider: providers })
}

export class UserProviderService {
  async list(username: string): Promise<string[]> {
    const config = await readConfig(configPathIn(settingRoot(username)))
    return Object.entries(providersOf(config))
      .filter(([, entry]) => Boolean(entry?.options?.apiKey))
      .map(([providerId]) => providerId)
  }

  async has(username: string, providerId: string): Promise<boolean> {
    return (await this.list(username)).includes(providerId)
  }

  async set(username: string, providerId: string, apiKey: string): Promise<void> {
    for (const directory of await listConfigDirectories(username)) {
      await upsertProvider(configPathIn(directory), providerId, apiKey)
    }
    logger.info(`Set per-user credentials for provider: ${providerId}`)
  }

  async delete(username: string, providerId: string): Promise<void> {
    for (const directory of await listConfigDirectories(username)) {
      await upsertProvider(configPathIn(directory), providerId, null)
    }
    logger.info(`Deleted per-user credentials for provider: ${providerId}`)
  }
}
