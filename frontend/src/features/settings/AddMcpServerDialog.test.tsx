import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AddMcpServerDialog } from './AddMcpServerDialog'
import { makeOpenCodeConfigFile } from '@/test/fixtures/opencode-config'
import { showErrorToast } from '@/lib/error-toast'

const {
  mockGetOpenCodeConfig,
  mockUpdateOpenCodeConfig,
  mockAddServerAsync,
} = vi.hoisted(() => ({
  mockGetOpenCodeConfig: vi.fn(),
  mockUpdateOpenCodeConfig: vi.fn(),
  mockAddServerAsync: vi.fn(),
}))

vi.mock('@/api/settings', () => ({
  settingsApi: {
    getOpenCodeConfig: mockGetOpenCodeConfig,
    updateOpenCodeConfig: mockUpdateOpenCodeConfig,
  },
}))

vi.mock('@/hooks/useMcpServers', () => ({
  useMcpServers: () => ({ addServerAsync: mockAddServerAsync, isAddingServer: false }),
}))

vi.mock('@/lib/toast', () => ({
  showToast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), loading: vi.fn(), warning: vi.fn(), dismiss: vi.fn() },
}))

vi.mock('@/lib/error-toast', () => ({
  showErrorToast: vi.fn(),
}))

const config = makeOpenCodeConfigFile()

function renderDialog(onUpdate: (content: Record<string, unknown>) => Promise<void>) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <AddMcpServerDialog open onOpenChange={vi.fn()} onUpdate={onUpdate} />
    </QueryClientProvider>,
  )
}

describe('AddMcpServerDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetOpenCodeConfig.mockResolvedValue(config)
    mockUpdateOpenCodeConfig.mockResolvedValue(config)
    mockAddServerAsync.mockResolvedValue(undefined)
  })

  it('issues exactly one config update through the owner callback and never writes directly', async () => {
    const onUpdate = vi.fn<(content: Record<string, unknown>) => Promise<void>>().mockResolvedValue(undefined)
    const user = userEvent.setup()
    renderDialog(onUpdate)

    await user.type(screen.getByLabelText('Server ID'), 'filesystem')
    await user.type(screen.getByLabelText('Command'), 'npx server-filesystem /tmp')
    await user.click(screen.getByRole('button', { name: 'Add MCP Server' }))

    await waitFor(() => expect(onUpdate).toHaveBeenCalledTimes(1))
    expect(mockUpdateOpenCodeConfig).not.toHaveBeenCalled()
    expect(onUpdate).toHaveBeenCalledWith({
      mcp: {
        filesystem: {
          type: 'local',
          enabled: true,
          command: ['npx', 'server-filesystem', '/tmp'],
        },
      },
    })
    expect(mockAddServerAsync).toHaveBeenCalledTimes(1)
  })

  it('passes only the merged content to onUpdate', async () => {
    const fetched = makeOpenCodeConfigFile({ revision: 'rev-B' })
    mockGetOpenCodeConfig.mockResolvedValue(fetched)
    const onUpdate = vi.fn<(content: Record<string, unknown>) => Promise<void>>().mockResolvedValue(undefined)
    const user = userEvent.setup()
    renderDialog(onUpdate)

    await user.type(screen.getByLabelText('Server ID'), 'filesystem')
    await user.type(screen.getByLabelText('Command'), 'npx server-filesystem /tmp')
    await user.click(screen.getByRole('button', { name: 'Add MCP Server' }))

    await waitFor(() => expect(onUpdate).toHaveBeenCalledTimes(1))
    const [content] = onUpdate.mock.calls[0]
    expect(onUpdate.mock.calls[0]).toHaveLength(1)
    expect((content.mcp as Record<string, unknown>).filesystem).toBeDefined()
    expect(mockUpdateOpenCodeConfig).not.toHaveBeenCalled()
  })

  it('shows the validation error it throws instead of throwing it into nowhere', async () => {
    const onUpdate = vi.fn<(content: Record<string, unknown>) => Promise<void>>().mockResolvedValue(undefined)
    const user = userEvent.setup()
    renderDialog(onUpdate)

    // a local server needs a command; the dialog already knows this
    await user.type(screen.getByLabelText('Server ID'), 'filesystem')
    await user.click(screen.getByRole('button', { name: 'Add MCP Server' }))

    await waitFor(() => expect(showErrorToast).toHaveBeenCalled())
    const [error, fallback] = vi.mocked(showErrorToast).mock.calls[0]
    expect((error as Error).message).toBe('Command is required for local MCP servers')
    expect(fallback).toBe('Could not add the MCP server')
    expect(onUpdate).not.toHaveBeenCalled()
    expect(mockAddServerAsync).not.toHaveBeenCalled()
  })

  it('keeps the dialog open when adding fails', async () => {
    const onUpdate = vi.fn<(content: Record<string, unknown>) => Promise<void>>()
      .mockRejectedValue(new Error('server said no'))
    const user = userEvent.setup()
    const onOpenChange = vi.fn()
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={queryClient}>
        <AddMcpServerDialog open onOpenChange={onOpenChange} onUpdate={onUpdate} />
      </QueryClientProvider>,
    )

    await user.type(screen.getByLabelText('Server ID'), 'filesystem')
    await user.type(screen.getByLabelText('Command'), 'npx server-filesystem /tmp')
    await user.click(screen.getByRole('button', { name: 'Add MCP Server' }))

    await waitFor(() => expect(showErrorToast).toHaveBeenCalled())
    expect(onOpenChange).not.toHaveBeenCalledWith(false)
  })
})
