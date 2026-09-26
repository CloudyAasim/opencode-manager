import { promises as fs } from 'fs'
import path from 'path'
import { getUserWorkspacePath } from '@opencode-manager/shared/config/env'
import { logger } from '../utils/logger'
import { mkdirSafe } from '../utils/fs-safe'

type ProviderEntry = { options?: Record<string, unknown> } & Record<string, unknown>

function workspaceRoot(username: string): string {
  return getUserWorkspacePath(username)
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
  const root = workspaceRoot(username)
  const directories = [root, path.join(root, 'assistant')]
  try {
    const entries = await fs.readdir(path.join(root, 'repos'), { withFileTypes: true })
    for (const entry of entries) {
      if (entry.isDirectory()) directories.push(path.join(root, 'repos', entry.name))
    }
  } catch {
    // no repos directory yet
  }
  return directories
}

async function upsertProvider(configPath: string, providerId: string, apiKey: string | null): Promise<void> {
  const config = await readConfig(configPath)
  const providers = { ...providersOf(config) }

  if (apiKey === null) {
    if (!(providerId in providers)) return
    delete providers[providerId]
  } else {
    const existing = providers[providerId] ?? {}
    providers[providerId] = { ...existing, options: { ...(existing.options ?? {}), apiKey } }
  }

  await writeConfig(configPath, { ...config, provider: providers })
}

/**
 * Provider credentials are stored per user across every OpenCode config their
 * sessions read (workspace root, assistant workspace and each of their repos),
 * so one account can never read or overwrite another account's providers.
 */
export class UserProviderService {
  async list(username: string): Promise<string[]> {
    const config = await readConfig(configPathIn(workspaceRoot(username)))
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
