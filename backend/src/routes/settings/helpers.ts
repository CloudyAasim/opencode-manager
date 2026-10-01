import { z } from 'zod'
import { existsSync } from 'fs'
import { resolve, dirname } from 'path'
import type { Context } from 'hono'
import type { OpenCodeSupervisor } from '../../services/opencode-supervisor'
import { logger } from '../../utils/logger'
import { ValidationError } from '../../utils/errors'
import { restartOpenCode } from '../../services/opencode-restart'
import { parseUploadManifest } from '../upload-utils'
import type { Database } from 'bun:sqlite'
import type { OpenCodeClient } from '../../services/opencode/client'
import { getRepoById } from '../../db/queries'
import type { SkillScope } from '@opencode-manager/shared'
import { opencodeServerManager } from '../../services/opencode-single-server'
export function getOpenCodeInstallMethod(): string {
  const homePath = process.env.HOME || ''
  const opencodePath = process.env.OPENCOD_PATH || resolve(homePath, '.opencode', 'bin', 'opencode')
  
  if (!existsSync(opencodePath)) return 'curl'
  
  try {
    const opencodeDir = dirname(opencodePath)
    if (opencodeDir.includes('.opencode')) return 'curl'
    
    if (opencodePath.includes('/homebrew/') || opencodePath.includes('/HOMEBREW/')) return 'brew'
    if (opencodePath.includes('/.npm/') || opencodePath.includes('/node_modules/')) return 'npm'
    if (opencodePath.includes('/.pnpm/')) return 'pnpm'
    if (opencodePath.includes('/.bun/')) return 'bun'
  } catch {
    return 'curl'
  }
  
  return 'curl'
}

async function restartOpenCodeSafe(openCodeSupervisor: OpenCodeSupervisor | undefined, context: string): Promise<void> {
  try {
    await restartOpenCode(openCodeSupervisor)
    logger.info(`Restarted OpenCode server after ${context}`)
  } catch (restartError) {
    logger.warn(`Failed to restart OpenCode server after ${context}:`, restartError)
  }
}

async function dispatchSkillReload(
  db: Database,
  openCodeClient: OpenCodeClient,
  openCodeSupervisor: OpenCodeSupervisor | undefined,
  repoId: number,
): Promise<void> {
  const repo = getRepoById(db, repoId)
  if (!repo) {
    logger.warn(`Cannot dispatch skill reload: repo ${repoId} not found`)
    return
  }

  await restartOpenCodeSafe(openCodeSupervisor, 'skill install')

  try {
    await openCodeClient.forward({
      method: 'GET',
      path: '/skill',
      directory: repo.fullPath,
    })
    logger.info(`Dispatched skill reload for project ${repo.fullPath}`)
  } catch (dispatchError) {
    logger.warn('Failed to dispatch skill reload:', dispatchError)
  }
}

export async function reloadAfterSkillInstall(
  db: Database,
  openCodeClient: OpenCodeClient,
  openCodeSupervisor: OpenCodeSupervisor | undefined,
  scope: SkillScope,
  repoId: number | undefined,
): Promise<boolean> {
  if (scope === 'project' && repoId !== undefined) {
    await dispatchSkillReload(db, openCodeClient, openCodeSupervisor, repoId)
    return false
  }

  opencodeServerManager.markRestartPending()
  return true
}

export const OPENCODE_DIRECTORY_UPLOAD_ERROR_STATUS: ReadonlyArray<readonly [string, 400]> = [
  ['No markdown', 400],
  ['Path must be relative', 400],
  ['Path must not contain', 400],
  ['Path must reference', 400],
  ['escapes', 400],
  ['Missing upload file', 400],
  ['not a valid file', 400],
]

export function matchErrorStatus<T extends number>(
  table: ReadonlyArray<readonly [string, T]>,
  error: Error,
): T | null {
  const match = table.find(([needle]) => error.message.includes(needle))
  return match ? match[1] : null
}

export function handleOpenCodeDirectoryFileError(c: Context, error: unknown, operation: string) {
  logger.error(`Failed to ${operation} OpenCode directory file:`, error)

  if (error instanceof z.ZodError) {
    return c.json({ error: 'Invalid request', details: error.issues }, 400)
  }

  if (error instanceof Error) {
    if ('code' in error && error.code === 'ENOENT') {
      return c.json({ error: 'File not found' }, 404)
    }

    const status = matchErrorStatus(OPENCODE_DIRECTORY_UPLOAD_ERROR_STATUS, error)
    if (status) {
      return c.json({ error: error.message }, status)
    }
  }

  return c.json({ error: `Failed to ${operation} OpenCode directory file` }, 500)
}

export const SKILL_INSTALL_ERROR_STATUS: ReadonlyArray<readonly [string, 400 | 404 | 409]> = [
  ['already exists', 409],
  ['404', 404],
  ['Invalid GitHub tree URL', 400],
  ['Invalid skill name', 400],
  ['Only one skill', 400],
  ['Skill source must contain', 400],
  ['Path must be relative', 400],
  ['Path must not contain', 400],
  ['escapes', 400],
  ['no downloadable files', 400],
  ['repoId is required', 400],
  ['Missing upload file', 400],
  ['Invalid repoId', 400],
  ['not a valid file', 400],
]

export function parseOptionalRepoId(value: string | undefined): number | undefined {
  if (value === undefined) return undefined
  const parsed = parseInt(value, 10)
  if (isNaN(parsed)) throw new ValidationError('Invalid repoId')
  return parsed
}

export function parseBooleanFormValue(value: unknown): boolean | undefined {
  if (value === true || value === 'true') return true
  if (value === false || value === 'false') return false
  return undefined
}

export function getMarkdownUploadManifest(manifest: ReturnType<typeof parseUploadManifest>) {
  return manifest.filter(entry => entry.relativePath.toLowerCase().endsWith('.md'))
}

export async function extractOpenCodeError(response: Response, defaultError: string): Promise<string> {
  const errorObj = await response.json().catch(() => null)
  return (errorObj && typeof errorObj === 'object' && 'error' in errorObj)
    ? String(errorObj.error)
    : defaultError
}

