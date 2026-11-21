import {
  DEFAULT_TTS_CONFIG,
  DEFAULT_STT_CONFIG,
  DEFAULT_KEYBOARD_SHORTCUTS,
  DEFAULT_DIRECT_SHORTCUTS,
  DEFAULT_USER_PREFERENCES,
  DEFAULT_LEADER_KEY,
  BLOCKED_SERVER_ENV_KEYS,
  DEFAULT_SERVER_ENV_VARS,
  selectPreferredOpenCodeConfigSourceName,
  type TTSConfig,
  type STTConfig,
  type OpenCodeConfigSourceName,
  type ModelConfig,
  type ProviderConfig,
  type SkillFileInfo,
  type CreateSkillRequest,
  type UpdateSkillRequest,
  type SkillScope,
  type InstallSkillFromGithubRequest,
  type InstallSkillResponse,
} from '@opencode-manager/shared'
import type { NotificationPreferences } from '@opencode-manager/shared/types'
import type { BffConfigurationDocument, BffConfigurationSource } from '@/api/bff'
import { saveFile } from '@/lib/download'

/**
 * The configuration, as the client holds it.
 *
 * It is the layer's own document, not the manager's: the client asks the
 * layer for the configuration and the layer says what the configuration is.
 * The two were the same thing only because both doors answered with the same
 * file - and the file holds the credentials of every model provider on the
 * host, so the door that answers with it is a door worth watching.
 */
export type OpenCodeConfigFile = BffConfigurationDocument

/**
 * One file the configuration is written down in.
 */
export type OpenCodeConfigSourceFile = BffConfigurationSource

export type { TTSConfig, STTConfig, OpenCodeConfigSourceName, ModelConfig, ProviderConfig, NotificationPreferences, SkillFileInfo, CreateSkillRequest, UpdateSkillRequest, SkillScope, InstallSkillFromGithubRequest, InstallSkillResponse }
export { DEFAULT_TTS_CONFIG, DEFAULT_STT_CONFIG, DEFAULT_KEYBOARD_SHORTCUTS, DEFAULT_DIRECT_SHORTCUTS, DEFAULT_USER_PREFERENCES, DEFAULT_LEADER_KEY, BLOCKED_SERVER_ENV_KEYS, DEFAULT_SERVER_ENV_VARS }
export { isOpenCodeConfigSourceName } from '@opencode-manager/shared'

export function getOpenCodeConfigSources(config: OpenCodeConfigFile): OpenCodeConfigSourceFile[] {
  return config.sources
}

export function getPreferredOpenCodeConfigSource(config: OpenCodeConfigFile): OpenCodeConfigSourceFile | null {
  const name = selectPreferredOpenCodeConfigSourceName(config.sources.map((source) => source.name))
  return name ? config.sources.find((source) => source.name === name) ?? null : null
}

export function downloadOpenCodeConfigSource(source: OpenCodeConfigSourceFile): void {
  const blob = new Blob([source.rawContent], { type: 'application/json' })
  void saveFile(blob, source.name)
}

export interface CustomCommand {
  name: string
  description: string
  promptTemplate: string
}

export interface GitCredential {
  id?: string
  name: string
  host: string
  type: 'pat' | 'ssh'
  token?: string
  sshPrivateKey?: string
  sshPrivateKeyEncrypted?: string
  hasPassphrase?: boolean
  username?: string
  passphrase?: string
}

export interface GitIdentity {
  name: string
  email: string
}

export interface UserPreferences {
  theme: 'dark' | 'light' | 'system'
  mode: 'plan' | 'build'
  defaultModel?: string
  defaultAgent?: string
  autoScroll: boolean
  expandDiffs: boolean
  expandToolCalls: boolean
  showReasoning: boolean
  simpleChatMode: boolean
  leaderKey?: string
  directShortcuts?: string[]
  keyboardShortcuts: Record<string, string>
  customCommands: CustomCommand[]
  gitCredentials?: GitCredential[]
  defaultGitCredentialId?: string
  gitIdentity?: GitIdentity
  tts?: TTSConfig
  stt?: STTConfig
  notifications?: NotificationPreferences
  repoOrder?: number[]
  repoSortMode?: 'recent' | 'manual' | 'name'
  serverEnvVars?: Array<{ key: string; value: string }>
  disabledDefaultServerEnvVars?: string[]
}

export interface SettingsResponse {
  preferences: UserPreferences
  updatedAt: number
  restartRequired?: boolean
}

export interface UpdateSettingsRequest {
  preferences: Partial<UserPreferences>
}

export interface OpenCodeConfigSaveResponse extends OpenCodeConfigFile {
  restartRequired?: boolean
  /**
   * The places where the client tried to change a credential and the server's
   * own value went back there instead.
   *
   * The client never saw a key, so it never wrote one - but it may have
   * written a value of its own or removed the line altogether, and both of
   * those are edits that did not happen. They are named so that the person can
   * be told.
   */
  overriddenCredentials?: string[]
}

export interface OpenCodeImportStatus {
  configSourcePath: string | null
  configSourcePaths: string[]
  stateSourcePath: string | null
  workspaceConfigPath: string
  workspaceConfigPathsToRemove: string[]
  workspaceStatePath: string
  workspaceStateExists: boolean
}

export interface SyncOpenCodeImportResponse extends OpenCodeImportStatus {
  success: boolean
  message: string
  serverRestarted: boolean
  configImported: boolean
  stateImported: boolean
  relinkedRepos?: {
    repos: Array<Record<string, unknown>>
    relinkedCount: number
    existingCount: number
    nonRepoPathCount: number
    duplicatePathCount: number
    errors: Array<{ path: string; error: string }>
  }
}

export interface OpenCodeDirectoryFileInfo {
  kind: 'agents' | 'commands'
  name: string
  relativePath: string
}
