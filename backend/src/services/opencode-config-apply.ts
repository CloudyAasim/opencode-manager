import type { Database } from 'bun:sqlite'
import { ServiceUnavailableError } from '../utils/errors'
import { logger } from '../utils/logger'
import { isDeepStrictEqual } from 'node:util'
import type {
  OpenCodeConfigFile,
  OpenCodeConfigSourceName,
} from '../types/settings'
import {
  buildOpenCodeConfigSeedSnapshot,
  readOpenCodeConfigFile,
  readOpenCodeConfigSnapshot,
  resolveWritableOpenCodeConfigSourceName,
  restoreOpenCodeConfigSnapshot,
  serializeOpenCodeConfigSnapshot,
  updateOpenCodeConfigFile,
  withOpenCodeConfigLock,
} from './opencode-config-file'
import {
  UNATTRIBUTED_ACTOR,
  diffOpenCodeConfig,
  recordOpenCodeConfigAudit,
  type OpenCodeConfigAuditActor,
  type OpenCodeConfigAuditScope,
} from './opencode-config-audit'
import { opencodeServerManager } from './opencode-single-server'
import type { SettingsService } from './settings'

export type ApplyOpenCodeConfigResult =
  | { status: 'restart_pending'; config: OpenCodeConfigFile }
  | { status: 'applied'; config: OpenCodeConfigFile }

export interface ApplyOpenCodeConfigInput {
  content: Record<string, unknown> | string
  source?: OpenCodeConfigSourceName
  expectedRevision?: string
  settingsService: SettingsService
  /**
   * Where the audit row goes. Absent means no row is written, which is how the
   * seed and restore paths - which are the app starting up, not a person
   * acting - call in without pretending to be an edit somebody made.
   */
  db?: Database
  actor?: OpenCodeConfigAuditActor | null
  scope?: OpenCodeConfigAuditScope
  subject?: string | null
}

export async function captureLastKnownGoodOpenCodeConfig(settingsService: SettingsService): Promise<OpenCodeConfigFile | null> {
  const previous = await readOpenCodeConfigFile()
  if (previous?.isValid) {
    settingsService.saveLastKnownGoodConfig(serializeOpenCodeConfigSnapshot(previous))
  }
  return previous
}

export async function restoreLastKnownGoodOpenCodeConfig(settingsService: SettingsService): Promise<OpenCodeConfigFile | null> {
  const lastGood = settingsService.getLastKnownGoodConfig()
  if (!lastGood) {
    return null
  }

  const config = await withOpenCodeConfigLock(() => restoreOpenCodeConfigSnapshot(lastGood))
  opencodeServerManager.clearStartupError()
  return config
}

export async function seedOpenCodeConfigFile(): Promise<OpenCodeConfigFile> {
  return withOpenCodeConfigLock(async () => {
    const config = await restoreOpenCodeConfigSnapshot(buildOpenCodeConfigSeedSnapshot())
    if (!config) {
      throw new ServiceUnavailableError('Failed to seed OpenCode config')
    }
    return config
  })
}

export function toOpenCodeConfigApplyResponse(
  result: ApplyOpenCodeConfigResult,
): { status: 200; body: Record<string, unknown> } {
  return {
    status: 200,
    body: result.status === 'restart_pending'
      ? { ...result.config, restartRequired: true }
      : { ...result.config },
  }
}

function requiresOpenCodeRestart(previous: OpenCodeConfigFile | null, next: OpenCodeConfigFile): boolean {
  if (previous?.isValid !== next.isValid) {
    return true
  }

  const previousContent = previous?.content ?? {}
  const keys = new Set([...Object.keys(previousContent), ...Object.keys(next.content)])
  for (const key of keys) {
    if (!isDeepStrictEqual(previousContent[key], next.content[key]) && key !== 'mcp') {
      return true
    }
  }

  return false
}

export async function applyOpenCodeConfigUpdate(
  input: ApplyOpenCodeConfigInput,
): Promise<ApplyOpenCodeConfigResult> {
  return withOpenCodeConfigLock(async () => {
    const { content, source, expectedRevision, settingsService, db, actor, scope, subject } = input

    const snapshot = await readOpenCodeConfigSnapshot()
    const previous = await readOpenCodeConfigFile(snapshot)

    const next = await updateOpenCodeConfigFile(content, { source, expectedRevision, snapshot })

    if (previous?.isValid) {
      const snapshot = serializeOpenCodeConfigSnapshot(previous)
      try {
        settingsService.saveLastKnownGoodConfig(snapshot)
      } catch (error) {
        await restoreOpenCodeConfigSnapshot(snapshot)
        throw error
      }
    }

    const restartPending = requiresOpenCodeRestart(previous, next)
    if (restartPending) {
      opencodeServerManager.markRestartPending()
    }

    // Inside the lock, so the row describes the write that actually landed
    // rather than one that raced it. Swallowed on failure on purpose: refusing
    // to save a configuration because the log could not be written would trade a
    // recorded change for an unrecorded one, and a loud log is what makes the
    // gap visible.
    if (db) {
      try {
        const { changedKeys, details } = diffOpenCodeConfig(previous?.content, next.content)
        recordOpenCodeConfigAudit(db, {
          actor: actor ?? UNATTRIBUTED_ACTOR,
          scope: scope ?? 'global',
          subject: subject ?? null,
          source: resolveWritableOpenCodeConfigSourceName(snapshot.sources, source),
          revision: next.revision,
          changedKeys,
          details,
          restartPending,
        })
      } catch (error) {
        logger.error('Failed to record OpenCode config audit', error)
      }
    }

    if (restartPending) {
      return { status: 'restart_pending', config: next }
    }

    return { status: 'applied', config: next }
  })
}
