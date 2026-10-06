import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AuditSettings } from './AuditSettings'
import { auditApi, type OpenCodeConfigAuditEntry } from '@/api/audit'

vi.mock('@/api/audit', () => ({
  auditApi: {
    listTerminal: vi.fn(),
    listConfig: vi.fn(),
    prune: vi.fn(),
  },
}))

vi.mock('@/components/ui/confirm-destructive-dialog', () => ({
  ConfirmDestructiveDialog: ({
    open,
    onConfirm,
  }: {
    open: boolean
    onOpenChange: (open: boolean) => void
    onConfirm: () => void
    onCancel: () => void
    title: string
    description: string
    confirmLabel: string
    cancelLabel: string
    isPending: boolean
  }) => (open ? <button onClick={onConfirm}>Confirm prune</button> : null),
}))

function terminalEntry(overrides: Record<string, unknown> = {}) {
  return {
    id: 't1',
    userId: 'u1',
    userEmail: 'admin@example.test',
    ipAddress: '203.0.113.10',
    userAgent: 'vitest',
    shell: '/bin/bash',
    cwd: '/workspace/users/alice',
    cols: 120,
    rows: 30,
    startedAt: 1_700_000_000_000,
    endedAt: 1_700_000_060_000,
    exitCode: 0,
    closeReason: 'client',
    totalBytes: 4096,
    active: false,
    ...overrides,
  }
}

function configEntry(overrides: Partial<OpenCodeConfigAuditEntry> = {}): OpenCodeConfigAuditEntry {
  return {
    id: 'c1',
    userId: 'u1',
    userEmail: 'admin@example.test',
    ipAddress: '203.0.113.10',
    userAgent: 'vitest',
    scope: 'global',
    subject: null,
    source: 'opencodode.jsonc',
    revision: 'rev-2',
    changedKeys: ['provider'],
    details: { provider: { added: ['acme'], removed: ['legacy'] } },
    restartPending: true,
    createdAt: 1_700_000_100_000,
    ...overrides,
  }
}

function renderAudit() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <AuditSettings />
    </QueryClientProvider>,
  )
}

describe('AuditSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(auditApi.listTerminal).mockResolvedValue({ entries: [terminalEntry()], total: 1 })
    vi.mocked(auditApi.listConfig).mockResolvedValue({ entries: [], total: 0 })
  })

  it('shows a configuration write as who did it, what changed, and which file it landed in', async () => {
    vi.mocked(auditApi.listConfig).mockResolvedValue({ entries: [configEntry()], total: 1 })
    const { container } = renderAudit()

    const row = await screen.findByText('+acme')
    const table = row.closest('table') as HTMLElement
    const cells = within(table).getAllByRole('row')[1]

    expect(within(cells).getByText('admin@example.test')).toBeInTheDocument()
    expect(within(cells).getByText('Everyone')).toBeInTheDocument()
    expect(within(cells).getByText('needs restart')).toBeInTheDocument()
    expect(within(cells).getByText('-legacy')).toBeInTheDocument()
    expect(within(cells).getByText('opencodode.jsonc')).toBeInTheDocument()
    expect(within(cells).getByText('203.0.113.10')).toBeInTheDocument()
    // The revision is not on screen. It is in the row for reconciling a
    // conflict, and a column of hashes is a column nobody reads.
    expect(container.textContent).not.toContain('rev-2')
  })

  it('names the key when a provider was only edited and none was added or removed', async () => {
    vi.mocked(auditApi.listConfig).mockResolvedValue({
      entries: [configEntry({ details: { provider: { added: [], removed: [] } } })],
      total: 1,
    })
    renderAudit()

    expect(await screen.findByText('provider')).toBeInTheDocument()
  })

  it('separates a tenant-scoped write from a global one', async () => {
    vi.mocked(auditApi.listConfig).mockResolvedValue({
      entries: [configEntry({ scope: 'user', subject: 'alice', changedKeys: ['theme'], details: null })],
      total: 1,
    })
    renderAudit()

    expect(await screen.findByText('alice only')).toBeInTheDocument()
    expect(screen.getByText('theme')).toBeInTheDocument()
  })

  it('does not claim a change when the row records none', async () => {
    vi.mocked(auditApi.listConfig).mockResolvedValue({
      entries: [configEntry({ changedKeys: [], details: null, restartPending: false })],
      total: 1,
    })
    renderAudit()

    expect(await screen.findByText('No visible change')).toBeInTheDocument()
    expect(screen.queryByText('needs restart')).not.toBeInTheDocument()
  })

  it('says a write has no owner rather than naming nobody', async () => {
    vi.mocked(auditApi.listConfig).mockResolvedValue({
      entries: [configEntry({ userId: null, userEmail: null })],
      total: 1,
    })
    renderAudit()

    expect(await screen.findByText('Unattributed')).toBeInTheDocument()
  })

  it('keeps the two tables separate when one of them is empty', async () => {
    renderAudit()

    expect(await screen.findByText('No configuration changes recorded.')).toBeInTheDocument()
    expect(screen.getByText('/workspace/users/alice')).toBeInTheDocument()
  })

  it('prunes both tables in one action and reports the combined count', async () => {
    const user = userEvent.setup()
    vi.mocked(auditApi.prune).mockResolvedValue({ terminal: 3, config: 2, deleted: 5 })
    renderAudit()

    await screen.findByText('/workspace/users/alice')
    await user.click(screen.getByRole('button', { name: /Prune older than 30 days/ }))
    await user.click(screen.getByRole('button', { name: 'Confirm prune' }))

    expect(auditApi.prune).toHaveBeenCalledTimes(1)
    expect(await screen.findByText('Pruned 5 entries')).toBeInTheDocument()
  })

  it('filters both tables by the same email', async () => {
    const user = userEvent.setup()
    renderAudit()

    await screen.findByText('/workspace/users/alice')
    await user.type(screen.getByLabelText('Filter by email'), 'admin@example.test')
    await user.click(screen.getByRole('button', { name: 'Confirm' }))

    await vi.waitFor(() => {
      expect(auditApi.listTerminal).toHaveBeenCalledWith(
        expect.objectContaining({ email: 'admin@example.test' }),
      )
      expect(auditApi.listConfig).toHaveBeenCalledWith(
        expect.objectContaining({ email: 'admin@example.test' }),
      )
    })
  })
})
