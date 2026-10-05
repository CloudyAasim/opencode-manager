import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ComponentProps } from 'react'
import { WorkspaceManager } from './WorkspaceManager'
import type { RepoSibling } from '@/api/repos'

/**
 * The worktree path is printed in both rows of this dialog, and the spelling
 * the server sends carries the account name and the internal layout. Showing
 * it verbatim is how a sibling listing ends up telling one user where another
 * user's worktrees sit on the host, so both rows go through `toDisplayPath`.
 *
 * The two rows are separate JSX branches, not one shared component, so both
 * are asserted here - covering only the default one would leave the manage
 * row free to print the raw path.
 */

const REAL_PATH = '/workspace/users/aasim/workspace/repos/RelayAB'
const DISPLAY_PATH = '/workspace/repos/RelayAB'

function sibling(overrides: Partial<RepoSibling> = {}): RepoSibling {
  return {
    id: 1,
    localPath: 'workspace/repos/RelayAB',
    fullPath: REAL_PATH,
    defaultBranch: 'main',
    cloneStatus: 'ready',
    clonedAt: 0,
    workspaceId: 'w-1',
    workspaceName: 'feature/login',
    ...overrides,
  }
}

function renderManager(
  workspaces: RepoSibling[],
  overrides: Partial<ComponentProps<typeof WorkspaceManager>> = {},
) {
  const onDelete = vi.fn()
  const onActiveWorkspaceChange = vi.fn()
  const onOpenChange = vi.fn()
  const onCreateWorkspace = vi.fn()
  render(
    <WorkspaceManager
      open
      onOpenChange={onOpenChange}
      workspaces={workspaces}
      onDelete={onDelete}
      onActiveWorkspaceChange={onActiveWorkspaceChange}
      onCreateWorkspace={onCreateWorkspace}
      {...overrides}
    />,
  )
  return { onDelete, onActiveWorkspaceChange, onOpenChange, onCreateWorkspace }
}

describe('WorkspaceManager', () => {
  it('shortens the worktree path in the list row', async () => {
    renderManager([sibling()])

    // Positive: the row is rendered, and the path is still there to read - just
    // without the host layout in front of it.
    expect(await screen.findByText('feature/login')).toBeInTheDocument()
    expect(screen.getByText(DISPLAY_PATH)).toBeInTheDocument()
    // Reverse: the raw path and the account name it carried are not printed.
    expect(screen.queryByText(REAL_PATH)).not.toBeInTheDocument()
    expect(document.body.textContent).not.toContain('users/aasim')
  })

  it('shortens the worktree path in the manage row too', async () => {
    const user = userEvent.setup()
    renderManager([sibling()])

    await user.click(screen.getByRole('button', { name: 'Manage' }))

    // Positive: the manage row is rendered, so the assertion below is about
    // this row and not about the list row left over from before the click.
    expect(await screen.findByRole('checkbox', { name: 'Select workspace feature/login' })).toBeInTheDocument()
    expect(screen.getByText(DISPLAY_PATH)).toBeInTheDocument()
    // Reverse: this row prints the shortened path too.
    expect(screen.queryByText(REAL_PATH)).not.toBeInTheDocument()
    expect(document.body.textContent).not.toContain('users/aasim')
  })

  it('still activates a workspace with its real path', async () => {
    // Display only. The row a user clicks has to hand back the path the tools
    // act on, so this fails if the shortened form ever reaches the call.
    const user = userEvent.setup()
    const { onActiveWorkspaceChange } = renderManager([sibling()])

    await user.click(await screen.findByText('feature/login'))

    expect(onActiveWorkspaceChange).toHaveBeenCalledWith(REAL_PATH)
  })

  it('leaves a worktree outside the managed roots spelled as it is', async () => {
    // `toDisplayPath` only rewrites the two roots the user navigates by.
    // Inventing a shorter form for anything else would show a path that does
    // not exist, and hiding a real path would make the row unverifiable.
    renderManager([sibling({ fullPath: '/opt/shared/checkout', workspaceName: 'hotfix' })])

    expect(await screen.findByText('hotfix')).toBeInTheDocument()
    expect(screen.getByText('/opt/shared/checkout')).toBeInTheDocument()
    expect(document.body.textContent).not.toContain('users/aasim')
  })

  it('says so when there are no workspaces, rather than showing a shortened nothing', async () => {
    renderManager([])

    expect(await screen.findByText('No workspaces found')).toBeInTheDocument()
    expect(screen.queryByText(DISPLAY_PATH)).not.toBeInTheDocument()
  })

  it('searches on the real path even though it displays the short one', async () => {
    // The search haystack is built from `fullPath`, and this pins that it
    // stays that way: matching the shortened form would make a search for the
    // path the user can actually see fail to find the row.
    const user = userEvent.setup()
    renderManager([sibling()])

    await user.type(screen.getByPlaceholderText('Search workspaces...'), 'RelayAB')

    expect(await screen.findByText('feature/login')).toBeInTheDocument()
    expect(screen.getByText(DISPLAY_PATH)).toBeInTheDocument()
  })

  it('renders a workspace with no path as a row with no path text', async () => {
    // An un-cloned workspace has no `fullPath`, so there is nothing to shorten
    // and nothing to print. The label must still be there, or the row would
    // read as an empty one.
    const { onActiveWorkspaceChange } = renderManager([sibling({ fullPath: '' })])

    expect(await screen.findByText('feature/login')).toBeInTheDocument()
    expect(screen.queryByText(DISPLAY_PATH)).not.toBeInTheDocument()
    expect(document.body.textContent).not.toContain('users/aasim')
    expect(onActiveWorkspaceChange).not.toHaveBeenCalled()
  })
})
