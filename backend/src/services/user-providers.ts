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

export function configPathIn(directory: string): string {
  return path.join(directory, 'opencode.json')
}

export async function readUserConfigFile(configPath: string): Promise<Record<string, unknown>> {
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

/**
 * Every place one tenant's provider config can be read from.
 *
 * OpenCode resolves a session's configuration by walking up from the session's
 * working directory, and a session's working directory is a checkout under
 * `workspace/repos/<name>`. So a declaration that is not present in that
 * directory is not in effect for that repository - which is why the list is
 * every directory rather than one file, and why `applyToRepo` exists for the
 * repositories that appear after the declaration was made.
 *
 * The bare `setting/` entry is what `list` reads to answer "does this tenant
 * have a key for that provider"; it is written alongside the rest so a
 * declaration and its key are never in different places.
 */
export async function listConfigDirectories(username: string): Promise<string[]> {
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
  const config = await readUserConfigFile(configPath)
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
 * Writes one provider entry into one config file, leaving everything else in
 * that file alone.
 *
 * Returns whether the file actually changed, so a caller fanning this out over
 * every directory can tell "already up to date" from "written" without
 * re-reading each file.
 */
async function putProviderEntry(
  configPath: string,
  providerId: string,
  entry: ProviderEntry | null,
): Promise<boolean> {
  const config = await readUserConfigFile(configPath)
  const providers = { ...providersOf(config) }

  if (entry === null) {
    if (!(providerId in providers)) return false
    delete providers[providerId]
  } else {
    const existing = providers[providerId]
    if (existing && JSON.stringify(existing) === JSON.stringify(entry)) return false
    // Keys this screen does not own are carried across, not dropped. A tenant
    // who attached an API key to a provider and then edited its models must not
    // lose the key by describing the provider again.
    providers[providerId] = { ...(existing ?? {}), ...entry }
  }

  await writeConfig(configPath, { ...config, provider: providers })
  return true
}

export class UserProviderService {
  async list(username: string): Promise<string[]> {
    const config = await readUserConfigFile(configPathIn(settingRoot(username)))
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

  /**
   * What this tenant has declared, read from the directory every session in
   * `setting/` sees rather than from a checkout.
   *
   * The entries come back whole because the editor reads them back into a form:
   * a summary would have to be re-fetched field by field, and the definition is
   * the thing being edited.
   */
  async declarations(username: string): Promise<Record<string, ProviderEntry>> {
    const config = await readUserConfigFile(configPathIn(settingRoot(username)))
    return providersOf(config)
  }

  /**
   * Declares a provider into every directory this tenant works in.
   *
   * Deliberately not the whole-config write the global endpoint takes. That one
   * accepts a merged document because an administrator is editing the server's
   * configuration; this one accepts exactly one provider entry, so there is no
   * shape of request that could reach `model`, `permission`, `agent`, `mcp` or
   * `plugin` from here - not a large one, and not one that forgot a field.
   */
  async declare(username: string, providerId: string, entry: ProviderEntry): Promise<void> {
    for (const directory of await listConfigDirectories(username)) {
      await putProviderEntry(configPathIn(directory), providerId, entry)
    }
    logger.info(`Declared per-user provider: ${providerId}`)
  }

  async undeclare(username: string, providerId: string): Promise<void> {
    for (const directory of await listConfigDirectories(username)) {
      await putProviderEntry(configPathIn(directory), providerId, null)
    }
    logger.info(`Removed per-user provider declaration: ${providerId}`)
  }

  /**
   * Replays this tenant's providers into one repository directory.
   *
   * Called when a repository appears, because a declaration written before the
   * repository existed is not in that repository's configuration and the
   * session that runs there would silently not see it.
   *
   * The entries come from `setting/`, where an attached API key already lives
   * inside the provider entry, so one pass carries both the definition and its
   * key. A second pass over `list()` would write the same `options` a second
   * time and could only ever agree with the first.
   */
  async syncIntoRepo(username: string, repoDirectory: string): Promise<void> {
    const declarations = await this.declarations(username)
    const configPath = configPathIn(repoDirectory)
    for (const [providerId, entry] of Object.entries(declarations)) {
      await putProviderEntry(configPath, providerId, entry)
    }
  }
}
