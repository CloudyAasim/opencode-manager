import type { Database } from 'bun:sqlite'
import type { OpenCodeConfigFile } from '../types/settings'
import { isOpenCodeConfigSourceName } from '@opencode-manager/shared'
import { ValidationError } from '../utils/errors'
import type { SettingsService } from './settings'
import {
  OpenCodeConfigConflictError,
  OpenCodeConfigShadowedRemovalError,
  readOpenCodeConfigFile,
  readOpenCodeConfigSnapshot,
  resolveWritableOpenCodeConfigSourceName,
  withOpenCodeConfigLock,
} from './opencode-config-file'
import { applyOpenCodeConfigUpdate } from './opencode-config-apply'
import {
  maskCredentials,
  maskCredentialsInText,
  restoreCredentials,
  restoreCredentialsInText,
} from './opencode-config-credentials'
import type { OpenCodeConfigAuditActor } from './opencode-config-audit'

/**
 * The configuration of the agent this server runs.
 *
 * The word here is "agent" and not the name of one, because everything above
 * this file has to be able to talk about the configuration of whichever agent
 * is behind it - the layer that answers the web client says "the
 * configuration", and this is where the name of the thing being configured
 * finally shows up.
 *
 * Two rules run through the whole file.
 *
 * **The credentials do not travel.** A credential is a string under a name
 * that says what it is, and it is replaced by a word that says "there is
 * something here, and it is not for you" before the document leaves the
 * server. The browser never had a reason to know the key of every model on
 * the host.
 *
 * **The server's own values win.** A client that writes a different value at
 * a credential path is not changing a key. A client that takes the thing the
 * key belonged to away - the provider - takes the key with it, because the
 * provider is the client's to change and the key is not.
 */

/**
 * A thing wrong with the configuration.
 */
export interface ConfigurationValidationIssue {
  path: string
  message: string
}

/**
 * One file the configuration is written down in.
 */
export interface ConfigurationSource {
  name: string
  path: string
  rawContent: string
  content: Record<string, unknown>
  isValid: boolean
  validationIssues?: ConfigurationValidationIssue[]
  updatedAt: number
}

/**
 * The configuration, with every credential behind a word.
 */
export interface ConfigurationDocument {
  path: string
  content: Record<string, unknown>
  rawContent: string
  isValid: boolean
  validationIssues?: ConfigurationValidationIssue[]
  updatedAt: number
  sources: ConfigurationSource[]
  revision: string
}

export interface ConfigurationUpdateInput {
  /**
   * The change: the whole document as a document, or the text of one source
   * file as it is written down.
   */
  content: Record<string, unknown> | string
  /** Which file to write, when the caller says. */
  source?: string
  /** The revision the caller read, so that two writers cannot both win. */
  expectedRevision?: string
  settingsService: SettingsService
  db?: Database
  actor?: OpenCodeConfigAuditActor | null
}

export interface ConfigurationUpdateResult {
  configuration: ConfigurationDocument
  /**
   * Whether the agent has to read the configuration again before it is the
   * configuration the agent is running with.
   */
  restartRequired: boolean
  /**
   * The paths where the client wrote a value of its own and the server's own
   * value went back there instead.
   *
   * They are named so that the person can be told. An edit that quietly does
   * not happen is worse than one that is refused: the person believes they
   * changed something, and they did not.
   */
  overriddenCredentials: string[]
}

/**
 * The configuration was changed by somebody else between the read and the
 * write.
 *
 * Said in this layer's words on purpose. The layer that answers the client
 * does not know which files the configuration is written down in, and it does
 * not need to: it needs to know that what the client read is not what is
 * there any more, and that the way out is to read again.
 */
export class ConfigurationConflictError extends Error {
  constructor(
    /** The revision the client read. */
    public readonly expectedRevision: string,
    /** The revision that is on disk now. */
    public readonly actualRevision: string,
  ) {
    super('The configuration was changed by another writer')
    this.name = 'ConfigurationConflictError'
  }
}

/**
 * A removal that another file still defines.
 *
 * The same reason as the conflict above: the files are the agent's business,
 * and the layer above has no business naming them.
 */
export class ConfigurationRemovalShadowedError extends Error {
  constructor(
    /** The paths that could not be removed here. */
    public readonly paths: string[],
    /** The files that define them. */
    public readonly sources: string[],
  ) {
    super(`These cannot be removed here: ${paths.join(', ')}`)
    this.name = 'ConfigurationRemovalShadowedError'
  }
}

/**
 * The document with every credential behind a word.
 *
 * The text is masked where it lies rather than by re-serializing it, so the
 * comments and the formatting the person wrote are still there when the
 * document comes back.
 */
export function maskConfigurationDocument(document: OpenCodeConfigFile): ConfigurationDocument {
  return {
    path: document.path,
    content: maskCredentials(document.content) as Record<string, unknown>,
    rawContent: maskCredentialsInText(document.rawContent, document.content),
    isValid: document.isValid,
    validationIssues: document.validationIssues,
    updatedAt: document.updatedAt,
    sources: document.sources.map((source) => ({
      name: source.name,
      path: source.path,
      rawContent: maskCredentialsInText(source.rawContent, source.content),
      content: maskCredentials(source.content) as Record<string, unknown>,
      isValid: source.isValid,
      validationIssues: source.validationIssues,
      updatedAt: source.updatedAt,
    })),
    revision: document.revision,
  }
}

/**
 * A document of the agent's own, with every credential behind a word.
 *
 * The agent's answer about what it is running with is a document too, and it
 * holds the same keys - the agent expanded them, and an expanded key is still
 * a key.
 */
export function maskConfigurationContent(content: unknown): Record<string, unknown> {
  return maskCredentials(content) as Record<string, unknown>
}

/**
 * The configuration, with every credential behind a word.
 *
 * Nothing, when there is no configuration on disk: a server that has never
 * been set up has nothing to say about it.
 */
export async function readConfigurationDocument(): Promise<ConfigurationDocument | null> {
  const file = await withOpenCodeConfigLock(readOpenCodeConfigFile)
  return file ? maskConfigurationDocument(file) : null
}

/**
 * A change to the configuration.
 *
 * The change is applied with the server's own credentials put back first, so
 * what lands on disk is the client's document with the keys the server has -
 * not the keys the client sent, and not the words that stand for them.
 */
export async function applyConfigurationUpdate(
  input: ConfigurationUpdateInput,
): Promise<ConfigurationUpdateResult> {
  const snapshot = await readOpenCodeConfigSnapshot()

  if (input.source !== undefined && !isOpenCodeConfigSourceName(input.source)) {
    // Said in this layer's words: the file names are the agent's business,
    // and a client that guessed one deserves to be told it is not a source
    // rather than which names there are.
    throw new ValidationError('That is not a configuration source')
  }

  const targetName = resolveWritableOpenCodeConfigSourceName(snapshot.sources, input.source)
  const target = snapshot.sources.find((source) => source.name === targetName)

  // Which credentials are the server's own depends on what is being written:
  // a document carries the credentials of every file it merged, and a file
  // carries only its own. Reading the wrong set would put a key from one file
  // into another.
  const own = typeof input.content === 'string'
    ? (target?.content ?? {})
    : snapshot.content

  const restored = typeof input.content === 'string'
    ? restoreCredentialsInText(input.content, own)
    : restoreCredentials(input.content, own)

  const result = await applyOpenCodeConfigUpdate({
    content: restored.value,
    source: targetName,
    expectedRevision: input.expectedRevision,
    settingsService: input.settingsService,
    db: input.db,
    actor: input.actor,
  }).catch((error: unknown) => {
    // The failures below are the file service's words, and they name files.
    // The layer above does not know the files, so the words are changed here -
    // at the one place where both vocabularies are known.
    if (error instanceof OpenCodeConfigConflictError) {
      throw new ConfigurationConflictError(error.expectedRevision, error.actualRevision)
    }
    if (error instanceof OpenCodeConfigShadowedRemovalError) {
      throw new ConfigurationRemovalShadowedError(error.paths, error.sources)
    }
    throw error
  })

  return {
    configuration: maskConfigurationDocument(result.config),
    restartRequired: result.status === 'restart_pending',
    overriddenCredentials: restored.overridden,
  }
}
