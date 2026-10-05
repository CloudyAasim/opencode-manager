import { createRepo, getRepoByLocalPath, getRepoById, getRepoByUrlAndBranch, ownedBy } from '../../db/queries'
import type { Database } from 'bun:sqlite'
import type { Repo, CreateRepoInput } from '../../types/repo'
import { logger } from '../../utils/logger'
import { getScheduleWorktreesPath } from '@opencode-manager/shared/config/env'
import { reposBase } from '../repo-paths'
import path from 'path'
import { sseAggregator } from '../sse-aggregator'
import { resolveProjectId, isGitMainCheckout } from '../project-id-resolver'
import { listRepos } from '../../db/queries'
import { listActiveScheduleRunWorkspaces } from '../../db/schedules'
import { SettingsService } from '../settings'
import type { OpenCodeClient } from '../opencode/client'
import { canonicalPathSync } from '../../utils/fs-safe'
import { getCurrentBranch } from './branch'

export function createRepoRow(
  database: Database,
  params: { name: string; originUrl?: string; localPath: string; fullPath: string; branch?: string; userId?: string | null }
): { repo: Repo; created: boolean } {
  const { originUrl, localPath, fullPath, branch, userId = null } = params

  // Scoped to the owner this row is being created for. Unscoped, a mirror
  // commit for one user would come back as "already exists" pointing at
  // somebody else's row.
  const scope = ownedBy(userId)
  const existing = originUrl
    ? getRepoByUrlAndBranch(database, originUrl, branch, scope)
    : getRepoByLocalPath(database, localPath, scope)

  if (existing) {
    return { repo: existing, created: false }
  }

  const repo = createRepo(database, {
    repoUrl: originUrl,
    localPath,
    sourcePath: fullPath,
    branch,
    defaultBranch: branch || 'main',
    cloneStatus: 'ready',
    clonedAt: Date.now(),
    isLocal: !originUrl,
    userId,
  } as CreateRepoInput)

  return { repo, created: true }
}

export function isRepoInUse(db: Database, repoId: number): boolean {
  const repo = getRepoById(db, repoId)
  if (!repo) {
    return false
  }

  return sseAggregator.getActiveDirectories().includes(repo.fullPath)
}

export async function getSiblingRepos(
  database: Database,
  repoId: number,
  gitEnv: Record<string, string>,
  openCodeClient?: OpenCodeClient,
): Promise<Array<Repo & { currentBranch: string | undefined }>> {
  const settingsService = new SettingsService(database)
  const settings = settingsService.getSettings()
  const allRepos = listRepos(database, settings.preferences.repoOrder)

  const target = allRepos.find((r) => r.id === repoId)
  if (!target || target.cloneStatus !== 'ready') return []

  const targetProjectId = await resolveProjectId(target.fullPath)
  if (!targetProjectId) return []

  const ready = allRepos.filter((r) => r.cloneStatus === 'ready')
  const withProjectIds = await Promise.all(
    ready.map(async (repo) => ({
      repo,
      projectId: await resolveProjectId(repo.fullPath).catch(() => null),
    })),
  )

  const matching = withProjectIds
    .filter((entry) => entry.projectId === targetProjectId)
    .map((entry) => entry.repo)

  const repoSiblings = await Promise.all(
    matching.map(async (repo) => ({
      ...repo,
      currentBranch: (await getCurrentBranch(repo, gitEnv)) ?? undefined,
    })),
  )

  if (!openCodeClient) return repoSiblings

  try {
    const workspaces = await openCodeClient.getJson<Array<{
      id: string
      type: string
      name: string | null
      branch: string | null
      directory: string | null
      projectID: string
    }>>('/experimental/workspace', { directory: target.fullPath })

    const knownDirectories = new Set(repoSiblings.map((repo) => canonicalPathSync(path.resolve(repo.fullPath))))
    const targetDirectory = canonicalPathSync(path.resolve(target.fullPath))
    const reposRoot = canonicalPathSync(path.resolve(reposBase()))
    const scheduleWorktreeRoot = canonicalPathSync(path.resolve(getScheduleWorktreesPath()))

    const activeRuns = listActiveScheduleRunWorkspaces(database)
    const activeRunWorkspaceIds = new Set(activeRuns.map((run) => run.workspaceId).filter((id): id is string => id !== null))
    const activeRunDirectories = new Set(
      activeRuns.map((run) => run.worktreePath).filter((p): p is string => p !== null).map((p) => canonicalPathSync(path.resolve(p))),
    )

    const candidates = workspaces.filter((workspace) => {
      if (workspace.projectID !== targetProjectId) return false
      if (!workspace.directory) return false

      const workspaceDirectory = canonicalPathSync(path.resolve(workspace.directory))
      if (workspaceDirectory === targetDirectory) return false
      if (workspaceDirectory === reposRoot) return false
      if (workspaceDirectory.startsWith(`${scheduleWorktreeRoot}${path.sep}`)) return false
      if (activeRunWorkspaceIds.has(workspace.id)) return false
      if (activeRunDirectories.has(workspaceDirectory)) return false
      if (knownDirectories.has(workspaceDirectory)) return false

      return true
    })

    const mainChecks = await Promise.all(
      candidates.map((workspace) => isGitMainCheckout(workspace.directory!).catch(() => false)),
    )

    const uniqueWorkspaces = new Map<string, typeof candidates[number]>()
    candidates
      .filter((_, index) => !mainChecks[index])
      .forEach((workspace) => {
        const directory = canonicalPathSync(path.resolve(workspace.directory!))
        if (!uniqueWorkspaces.has(directory)) {
          uniqueWorkspaces.set(directory, workspace)
        }
      })

    const workspaceSiblings = Array.from(uniqueWorkspaces.values())
      .map((workspace) => ({
        id: -1,
        repoUrl: target.repoUrl,
        localPath: workspace.name ?? workspace.id,
        fullPath: workspace.directory!,
        sourcePath: workspace.directory!,
        branch: workspace.branch ?? undefined,
        defaultBranch: target.defaultBranch,
        cloneStatus: 'ready' as const,
        clonedAt: Date.now(),
        isWorktree: true,
        isLocal: true,
        currentBranch: workspace.branch ?? undefined,
        workspaceId: workspace.id,
        workspaceType: workspace.type,
        workspaceName: workspace.name ?? undefined,
      }))

    return [...repoSiblings, ...workspaceSiblings]
  } catch (error) {
    logger.warn('Failed to list OpenCode workspaces:', error)
    return repoSiblings
  }
}
