import type { RemoteRepoSummary } from './mirror.js'

export interface ManagerRepo {
  repoId: number
  name: string
  branch: string | null
  cloneStatus: string
  directory: string
  projectId?: string | null
  isWorktree?: boolean
  extra: { repoId: number; localPath: string; fullPath: string }
}

/**
 * What a 401 from the manager means, in terms the person can act on.
 *
 * The manager used to hand every signed-in user the same token - the OpenCode
 * plugin's own - so a copy pasted into the CLI authenticated every tenant at
 * once. It now issues one token per person, and a request carrying the old
 * shared value is refused. Without this, every existing install breaks on the
 * same call with `manager responded 401 Unauthorized`, which says nothing about
 * which of the two things they hold is the wrong one.
 */
export function unauthorizedMessage(managerUrl: string): string {
  return [
    `${managerUrl} refused the stored token (401).`,
    'Manager tokens are now per user.',
    'Open Settings in the web UI, copy your own Manager Internal Token, and run `ocm login` again.',
    'Installations from before this change stored the shared plugin token, which the server no longer accepts on its own.',
  ].join(' ')
}

export async function fetchRepos(managerUrl: string, token: string): Promise<ManagerRepo[]> {
  const res = await fetch(`${managerUrl}/api/internal/opencode-workspaces`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (res.status === 401) {
    throw new Error(unauthorizedMessage(managerUrl))
  }
  if (!res.ok) {
    throw new Error(`manager responded ${res.status} ${res.statusText}`)
  }
  const data = (await res.json()) as { workspaces: ManagerRepo[] }
  return data.workspaces
}

export function toRemoteRepoSummaries(repos: ManagerRepo[]): RemoteRepoSummary[] {
  return repos.map((r) => ({
    repoId: r.repoId,
    name: r.name,
    projectId: r.projectId ?? null,
    branch: r.branch,
  }))
}
