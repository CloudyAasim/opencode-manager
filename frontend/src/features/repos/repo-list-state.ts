import type { Repo } from "@/api/types"
import type { GitStatusResponse } from "@/types/git"
import { getRepoDisplayName } from "@/lib/utils"

export type RepoFilterMode = 'all' | 'recent' | 'attention' | 'worktrees' | 'local'
export type RepoSortMode = 'recent' | 'manual' | 'name'

export interface RepoAttentionState {
  hasChanges: boolean
  ahead: number
  behind: number
  isCloneStatusReady: boolean
}

export interface RepoViewModel extends Repo {
  attentionState: RepoAttentionState
  activityTimestamp: number
}

export function getActivityTimestamp(repo: Repo): number {
  return repo.lastAccessedAt ?? repo.lastPulled ?? repo.clonedAt
}

export function getAttentionState(repo: Repo, gitStatus?: GitStatusResponse): RepoAttentionState {
  if (!gitStatus || repo.cloneStatus !== 'ready') {
    return {
      hasChanges: false,
      ahead: 0,
      behind: 0,
      isCloneStatusReady: repo.cloneStatus === 'ready'
    }
  }

  return {
    hasChanges: gitStatus.hasChanges,
    ahead: gitStatus.ahead,
    behind: gitStatus.behind,
    isCloneStatusReady: true
  }
}

export function dedupeRepos(repos: Repo[]): Repo[] {
  return repos.reduce((acc, repo) => {
    if (repo.isWorktree) {
      acc.push(repo)
    } else {
      const key = repo.repoUrl || repo.sourcePath || repo.localPath
      const existing = acc.find(
        (r) => (r.repoUrl || r.sourcePath || r.localPath) === key && !r.isWorktree
      )

      if (!existing) {
        acc.push(repo)
      }
    }

    return acc
  }, [] as Repo[])
}

export function buildRepoViewModels(
  repos: Repo[],
  gitStatuses: Map<number, GitStatusResponse> | undefined
): RepoViewModel[] {
  return dedupeRepos(repos).map((repo) => ({
    ...repo,
    attentionState: getAttentionState(repo, gitStatuses?.get(repo.id)),
    activityTimestamp: getActivityTimestamp(repo)
  }))
}

export function filterReposBySearch(repos: RepoViewModel[], searchQuery: string): RepoViewModel[] {
  if (!searchQuery.trim()) {
    return repos
  }

  const query = searchQuery.toLowerCase()
  return repos.filter((repo) => {
    const repoName = getRepoDisplayName(repo)
    const searchTarget = repo.repoUrl || repo.sourcePath || repo.localPath || ""
    return (
      repoName.toLowerCase().includes(query) ||
      searchTarget.toLowerCase().includes(query)
    )
  })
}

export function filterReposByMode(repos: RepoViewModel[], mode: RepoFilterMode): RepoViewModel[] {
  switch (mode) {
    case 'recent':
      return repos.filter((repo) => repo.attentionState.isCloneStatusReady)
    case 'attention':
      return repos.filter(
        (repo) =>
          repo.attentionState.hasChanges ||
          repo.attentionState.ahead > 0 ||
          repo.attentionState.behind > 0
      )
    case 'worktrees':
      return repos.filter((repo) => repo.isWorktree)
    case 'local':
      return repos.filter((repo) => repo.isLocal)
    case 'all':
    default:
      return repos
  }
}

export function sortRepos(repos: RepoViewModel[], mode: RepoSortMode, manualOrder?: number[]): RepoViewModel[] {
  switch (mode) {
    case 'recent':
      return [...repos].sort((a, b) => b.activityTimestamp - a.activityTimestamp)
    case 'name':
      return [...repos].sort((a, b) => {
        const nameA = getRepoDisplayName(a).toLowerCase()
        const nameB = getRepoDisplayName(b).toLowerCase()
        return nameA.localeCompare(nameB)
      })
    case 'manual': {
      if (!manualOrder || manualOrder.length === 0) {
        return repos
      }
      const orderMap = new Map(manualOrder.map((id, index) => [id, index]))
      const orderedRepos = repos
        .filter((repo) => orderMap.has(repo.id))
        .sort((a, b) => {
          const indexA = orderMap.get(a.id)!
          const indexB = orderMap.get(b.id)!
          return indexA - indexB
        })
      const remainingRepos = repos.filter((repo) => !orderMap.has(repo.id))
      return [...orderedRepos, ...remainingRepos]
    }
    default:
      return repos
  }
}

export function countAttentionItems(repos: RepoViewModel[]): number {
  return repos.filter(
    (repo) =>
      repo.attentionState.hasChanges ||
      repo.attentionState.ahead > 0 ||
      repo.attentionState.behind > 0
  ).length
}