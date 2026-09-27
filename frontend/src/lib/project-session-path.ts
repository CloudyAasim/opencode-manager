export type WorktreeTabValue = 'repo' | 'workspaces'

/**
 * Route for a project's session. Repository 0 is the Assistant, whose sessions
 * must carry the `assistant=1` flag so the session page resolves the per-user
 * assistant workspace; workspace worktrees carry `repoTab=workspaces`.
 */
export function projectSessionPath(
  repoId: number,
  sessionId: string,
  activeTab: WorktreeTabValue = 'repo',
): string {
  const suffix = repoId === 0
    ? '?assistant=1'
    : activeTab === 'workspaces'
      ? '?repoTab=workspaces'
      : ''
  return `/repos/${repoId}/sessions/${sessionId}${suffix}`
}
