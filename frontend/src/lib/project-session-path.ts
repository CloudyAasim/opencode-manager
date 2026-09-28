export type WorktreeTabValue = 'repo' | 'workspaces'

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
