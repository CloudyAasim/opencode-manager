import type { Repo } from './types'
import { FetchError, fetchWrapper, fetchWrapperVoid, fetchWrapperBlob } from './fetchWrapper'
import { API_BASE_URL } from '@/config'
import { REQUEST_TIMEOUTS } from './timeouts'
import { saveFile } from '@/lib/download'
import type { DiscoverReposResponse, AssistantModeStatus, AssistantModeInitRequest } from '@opencode-manager/shared/types'

export interface CreateRepoOptions {
  repoUrl?: string
  localPath?: string
  branch?: string
  directoryName?: string
  useWorktree?: boolean
  skipSSHVerification?: boolean
  baseBranch?: string
}

export async function createRepo(options: CreateRepoOptions = {}): Promise<Repo> {
  return fetchWrapper(`${API_BASE_URL}/api/repos`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(options),
    // a URL spends up to five minutes inside `git clone` on the server
    timeout: REQUEST_TIMEOUTS.clone,
  })
}

export async function listRepos(): Promise<Repo[]> {
  return fetchWrapper(`${API_BASE_URL}/api/repos`)
}

export async function discoverRepos(rootPath: string, maxDepth?: number): Promise<DiscoverReposResponse> {
  return fetchWrapper(`${API_BASE_URL}/api/repos/discover`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ rootPath, maxDepth }),
  })
}

export async function getRepo(id: number): Promise<Repo> {
  return fetchWrapper(`${API_BASE_URL}/api/repos/${id}`)
}

export type RepoSibling = Repo & {
  currentBranch?: string
  workspaceId?: string
  workspaceType?: string
  workspaceName?: string
}

export function workspaceLabel(workspace: RepoSibling): string {
  return (
    workspace.currentBranch ||
    workspace.branch ||
    workspace.workspaceName ||
    workspace.workspaceId ||
    'workspace'
  )
}

export interface RepoWorkspace {
  id: string
  type: string
  name?: string | null
  branch?: string | null
  directory?: string | null
  projectID?: string
}

export async function getRepoSiblings(id: number): Promise<RepoSibling[]> {
  return fetchWrapper(`${API_BASE_URL}/api/repos/${id}/siblings`)
}

export async function deleteRepoWorkspace(repoId: number, workspaceId: string): Promise<void> {
  return fetchWrapperVoid(`${API_BASE_URL}/api/repos/${repoId}/workspaces/${workspaceId}`, {
    method: 'DELETE',
  })
}

export async function createRepoWorkspace(repoId: number): Promise<RepoWorkspace> {
  return fetchWrapper(`${API_BASE_URL}/api/repos/${repoId}/workspaces`, {
    method: 'POST',
  })
}

export interface RepoDeleteResult {
  success?: boolean
  /** Conversations removed along with the checkout. */
  sessionsDeleted?: number
  /**
   * True when some conversations could not be removed. The repository itself
   * is gone either way, so this is not a failure - but it has to reach the
   * user, because a leftover conversation is exactly what comes back if the
   * project is added again.
   */
  sessionsPurgeIncomplete?: boolean
  /**
   * False when the row left the list but nothing on disk was deleted, because
   * the stored path pointed outside the project directory and was refused.
   * Also not a failure - the user asked for it to stop being a project - but
   * the files are still there and saying so is the only honest option.
   */
  filesRemoved?: boolean
  refusal?: string
}

export async function deleteRepo(id: number): Promise<RepoDeleteResult> {
  return fetchWrapper<RepoDeleteResult>(`${API_BASE_URL}/api/repos/${id}`, {
    method: 'DELETE',
  })
}

export async function updateRepoGitCredential(id: number, credentialId?: string): Promise<Repo> {
  return fetchWrapper(`${API_BASE_URL}/api/repos/${id}/git-credential`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ credentialId }),
  })
}

export async function renameRepo(id: number, name: string | null): Promise<Repo> {
  return fetchWrapper(`${API_BASE_URL}/api/repos/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: name ?? '' }),
  })
}

export class GitAuthError extends Error {
  code: string
  constructor(message: string, code: string) {
    super(message)
    this.name = 'GitAuthError'
    this.code = code
  }
}

export async function switchBranch(id: number, branch: string): Promise<Repo> {
  try {
    return await fetchWrapper(`${API_BASE_URL}/api/repos/${id}/branch/switch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ branch }),
    })
  } catch (error) {
    if (error instanceof FetchError && error.code === 'AUTH_FAILED') {
      throw new GitAuthError(error.message, error.code)
    }
    throw error
  }
}

interface GitBranch {
  name: string
  type: 'local' | 'remote'
  current: boolean
  upstream?: string
  ahead?: number
  behind?: number
  isWorktree?: boolean
}

export async function listBranches(id: number): Promise<{ branches: GitBranch[], status: { ahead: number, behind: number } }> {
  return fetchWrapper(`${API_BASE_URL}/api/repos/${id}/git/branches`)
}

export async function createBranch(id: number, branch: string): Promise<Repo> {
  try {
    return await fetchWrapper(`${API_BASE_URL}/api/repos/${id}/branch/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ branch }),
    })
  } catch (error) {
    if (error instanceof FetchError && error.code === 'AUTH_FAILED') {
      throw new GitAuthError(error.message, error.code)
    }
    throw error
  }
}

export interface DownloadOptions {
  includeGit?: boolean
  includePaths?: string[]
}

export async function downloadRepo(id: number, repoName: string, options?: DownloadOptions): Promise<void> {
  const params = new URLSearchParams()
  if (options?.includeGit) params.append('includeGit', 'true')
  if (options?.includePaths?.length) params.append('includePaths', options.includePaths.join(','))

  const url = `${API_BASE_URL}/api/repos/${id}/download${params.toString() ? '?' + params.toString() : ''}`
  
  const blob = await fetchWrapperBlob(url)
  await saveFile(blob, `${repoName}.zip`)
}

export async function updateRepoOrder(order: number[]): Promise<void> {
  return fetchWrapperVoid(`${API_BASE_URL}/api/repos/order`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ order }),
  })
}

export async function resetRepoPermissions(id: number): Promise<void> {
  return fetchWrapperVoid(`${API_BASE_URL}/api/repos/${id}/reset-permissions`, {
    method: 'POST',
  })
}

export async function touchRepoActivity(id: number): Promise<void> {
  return fetchWrapperVoid(`${API_BASE_URL}/api/repos/${id}/access`, {
    method: 'POST',
  })
}

export async function getAssistantModeStatus(id: number): Promise<AssistantModeStatus> {
  return fetchWrapper(`${API_BASE_URL}/api/repos/${id}/assistant-mode`, {
    method: 'GET',
  })
}

export async function initializeAssistantMode(
  id: number,
  options?: AssistantModeInitRequest
): Promise<AssistantModeStatus> {
  return fetchWrapper(`${API_BASE_URL}/api/repos/${id}/assistant-mode`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(options ?? {}),
  })
}
