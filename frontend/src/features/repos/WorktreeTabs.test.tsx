import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { WorktreeTabs } from './WorktreeTabs'
import type { RepoSibling } from '@/api/repos'

const makeWorkspaceSibling = (workspaceId: string, branch: string): RepoSibling => ({
  id: -1,
  localPath: branch,
  fullPath: `/w/${branch}`,
  defaultBranch: 'main',
  cloneStatus: 'ready',
  clonedAt: 0,
  isWorktree: true,
  currentBranch: branch,
  branch,
  workspaceId,
  workspaceName: branch,
})

const onValueChange = vi.fn()
const onCreateWorkspace = vi.fn()

beforeEach(() => {
  onValueChange.mockReset()
  onCreateWorkspace.mockReset()
})

describe('WorktreeTabs', () => {
  it('renders the repo tab when there are no workspaces', () => {
    render(
      <WorktreeTabs
        workspaces={[]}
        value="repo"
        onValueChange={onValueChange}
        baseLabel="main"
        onCreateWorkspace={onCreateWorkspace}
      />
    )
    expect(screen.getAllByRole('tab')).toHaveLength(1)
    expect(screen.getByText('main')).toBeInTheDocument()
  })

  it('renders Repo and Workspaces tabs when at least one workspace exists', () => {
    const workspaces = [makeWorkspaceSibling('wrk_a', 'feature-a')]
    render(
      <WorktreeTabs
        workspaces={workspaces}
        value="repo"
        onValueChange={onValueChange}
        baseLabel="main"
        onCreateWorkspace={onCreateWorkspace}
      />
    )

    const tabs = screen.getAllByRole('tab')
    expect(tabs).toHaveLength(2)
    expect(screen.getByText('main')).toBeInTheDocument()
    expect(screen.getByText('Workspaces')).toBeInTheDocument()
    expect(screen.getByText('(1)')).toBeInTheDocument()
  })

  it('has one key that makes a workspace, whether there are none or many', () => {
    const { rerender } = render(
      <WorktreeTabs
        workspaces={[]}
        value="repo"
        onValueChange={onValueChange}
        baseLabel="main"
        onCreateWorkspace={onCreateWorkspace}
      />
    )
    expect(screen.getAllByRole('button', { name: 'New Workspace' })).toHaveLength(1)

    rerender(
      <WorktreeTabs
        workspaces={[makeWorkspaceSibling('wrk_a', 'feature-a')]}
        value="repo"
        onValueChange={onValueChange}
        baseLabel="main"
        onCreateWorkspace={onCreateWorkspace}
      />
    )
    expect(screen.getAllByRole('button', { name: 'New Workspace' })).toHaveLength(1)
  })

  it('makes a workspace when the key is pressed', async () => {
    render(
      <WorktreeTabs
        workspaces={[makeWorkspaceSibling('wrk_a', 'feature-a')]}
        value="repo"
        onValueChange={onValueChange}
        baseLabel="main"
        onCreateWorkspace={onCreateWorkspace}
      />
    )

    await userEvent.click(screen.getByRole('button', { name: 'New Workspace' }))
    expect(onCreateWorkspace).toHaveBeenCalledTimes(1)
  })

  it('the workspace tab opens the manager, and only the key makes one', async () => {
    const onWorkspaceMenu = vi.fn()
    render(
      <WorktreeTabs
        workspaces={[makeWorkspaceSibling('wrk_a', 'feature-a')]}
        value="repo"
        onValueChange={onValueChange}
        baseLabel="main"
        onCreateWorkspace={onCreateWorkspace}
        onWorkspaceMenu={onWorkspaceMenu}
      />
    )

    await userEvent.click(screen.getAllByRole('tab')[1])
    expect(onWorkspaceMenu).toHaveBeenCalledTimes(1)
    expect(onCreateWorkspace).not.toHaveBeenCalled()
  })

  it('marks the active tab', () => {
    const workspaces = [makeWorkspaceSibling('wrk_a', 'feature-a')]
    render(
      <WorktreeTabs
        workspaces={workspaces}
        value="workspaces"
        onValueChange={onValueChange}
        baseLabel="main"
        onCreateWorkspace={onCreateWorkspace}
      />
    )

    const tabs = screen.getAllByRole('tab')
    expect(tabs[0]).toHaveAttribute('data-state', 'inactive')
    expect(tabs[1]).toHaveAttribute('data-state', 'active')
  })

  it('calls onValueChange when a different tab is clicked', async () => {
    const workspaces = [makeWorkspaceSibling('wrk_a', 'feature-a')]
    render(
      <WorktreeTabs
        workspaces={workspaces}
        value="repo"
        onValueChange={onValueChange}
        baseLabel="main"
        onCreateWorkspace={onCreateWorkspace}
      />
    )

    await userEvent.click(screen.getAllByRole('tab')[1])
    expect(onValueChange).toHaveBeenCalledWith('workspaces')
  })

  it('shows the workspace count in the workspaces tab', () => {
    const workspaces = [
      makeWorkspaceSibling('wrk_a', 'feature-a'),
      makeWorkspaceSibling('wrk_b', 'feature-b'),
      makeWorkspaceSibling('wrk_c', 'feature-c'),
    ]
    render(
      <WorktreeTabs
        workspaces={workspaces}
        value="repo"
        onValueChange={onValueChange}
        baseLabel="main"
        onCreateWorkspace={onCreateWorkspace}
      />
    )

    expect(screen.getByText('(3)')).toBeInTheDocument()
  })
})
