import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { RepoRowActions } from './RepoRowActions'

vi.mock('@/api/repos', async () => {
  const actual = await vi.importActual<typeof import('@/api/repos')>('@/api/repos')
  return { ...actual, resetRepoPermissions: vi.fn(async () => undefined) }
})
vi.mock('@/features/source-control/SourceControlPanel', () => ({ SourceControlPanel: () => null }))
vi.mock('@/components/ui/download-dialog', () => ({ DownloadDialog: () => null }))
vi.mock('@/features/repos/CreateWorktreeDialog', () => ({ CreateWorktreeDialog: () => null }))
vi.mock('@/features/repos/RenameRepoDialog', () => ({ RenameRepoDialog: () => null }))

const REPO = {
  id: 42,
  name: 'demo',
  localPath: '/repos/demo',
  fullPath: '/repos/demo',
  cloneStatus: 'ready' as const,
  isWorktree: false,
  isLocal: false,
}

// isMobile picks the overflow menu; the wide layout uses a row of icon buttons.
const renderRow = (isMobile: boolean) =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <RepoRowActions repo={REPO} onDelete={vi.fn()} isDeleting={false} isMobile={isMobile} />
    </QueryClientProvider>,
  )

describe('RepoRowActions 的重置权限入口', () => {
  beforeEach(() => vi.clearAllMocks())

  it('窄屏的溢出菜单里有这一项', () => {
    renderRow(true)

    // Radix opens its menu on pointerdown, not click
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Repository actions' }), { button: 0 })
    expect(within(screen.getByRole('menu')).getByText('Reset Permissions')).toBeInTheDocument()
  })

  it('宽屏的图标行里也有', () => {
    renderRow(false)

    expect(screen.getByRole('button', { name: 'Reset Permissions' })).toBeInTheDocument()
  })

  it('点它能把重置弹层送到前台', () => {
    renderRow(false)

    fireEvent.click(screen.getByRole('button', { name: 'Reset Permissions' }))
    expect(screen.getByRole('heading', { name: 'Reset Permissions' })).toBeInTheDocument()
  })
})

describe('RepoRowActions 在目录缺失时', () => {
  beforeEach(() => vi.clearAllMocks())

  const renderMissing = (isMobile: boolean) =>
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <RepoRowActions
          repo={{ ...REPO, directoryExists: false }}
          onDelete={vi.fn()}
          isDeleting={false}
          isMobile={isMobile}
        />
      </QueryClientProvider>,
    )

  it('不再提供作用于那个目录的操作', () => {
    // pull / worktree / rename / source control all act on the directory, and
    // all of them fail at the far end - after the user committed to the action.
    // The control stays visible and disabled: an action that silently vanished
    // is harder to reason about than one that is visibly unavailable.
    renderMissing(false)

    expect(screen.getByRole('button', { name: 'Reset Permissions' })).toBeDisabled()
  })

  it('窄屏的溢出菜单里同样禁用', () => {
    renderMissing(true)

    fireEvent.pointerDown(screen.getByRole('button', { name: 'Repository actions' }), { button: 0 })
    const item = within(screen.getByRole('menu')).getByText('Reset Permissions').closest('[role="menuitem"]')
    expect(item).toHaveAttribute('data-disabled')
  })

  it('目录还在时照常提供', () => {
    // The other direction: a missing directory must not disable everything for
    // every user on a backend that never sends the field.
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <RepoRowActions repo={REPO} onDelete={vi.fn()} isDeleting={false} isMobile={false} />
      </QueryClientProvider>,
    )

    expect(screen.getByRole('button', { name: 'Reset Permissions' })).not.toBeDisabled()
  })
})
