import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { TerminalPage } from '../Terminal'
import { terminalApi, type TerminalRuntimeConfig } from '@/api/terminal'

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ user: { id: 'user-1', email: 'admin@example.com', name: 'Admin', role: 'admin' } }),
}))

vi.mock('@/lib/i18n', () => ({
  useI18n: () => ({ t: (key: string) => key }),
}))

vi.mock('@/features/terminal/TerminalView', () => ({
  TerminalView: () => <div data-testid="terminal-view" />,
}))

vi.mock('@/api/terminal', () => ({
  terminalApi: {
    getConfig: vi.fn(),
  },
}))

const CONFIG: TerminalRuntimeConfig = {
  enabled: true,
  available: true,
  sandboxAvailable: true,
  shell: '/bin/bash',
  cwd: '/workspace/users/admin/workspace',
  cols: 80,
  idleTimeoutMs: 0,
  maxDurationMs: 0,
  maxSessionsPerUser: 1,
  adminsOnly: false,
  perUserHome: false,
}

function wrapper({ children }: { children: React.ReactNode }) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return (
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  )
}

async function renderPage() {
  render(<TerminalPage />, { wrapper })
  await waitFor(() => expect(screen.getByTestId('terminal-view')).toBeInTheDocument())
}

/**
 * The terminal page says what it is with the shared title bar.
 *
 * It used to say it with a section heading - the component that draws the
 * heading *inside* a page - so the page title was drawn at a section's size
 * and the page had no `<h1>` of its own. Now the page's name, its mark and
 * the line under it all come from the one shared title bar.
 */
describe('TerminalPage', () => {
  beforeEach(() => {
    vi.mocked(terminalApi.getConfig).mockResolvedValue(CONFIG)
  })

  it('names itself with the shared page title', async () => {
    await renderPage()

    expect(screen.getByRole('heading', { level: 1, name: 'terminal.title' })).toBeInTheDocument()
  })

  it('says what the terminal is under the name', async () => {
    await renderPage()

    expect(screen.getByText('terminal.description')).toBeInTheDocument()
  })

  it('still says which shell and which directory it runs in', async () => {
    await renderPage()

    // The label and the value are separate nodes, so the text is looked for
    // in the title bar as a whole rather than in one element.
    const bar = screen.getByRole('banner')
    expect(bar).toHaveTextContent('terminal.shell')
    expect(bar).toHaveTextContent('/bin/bash')
    expect(bar).toHaveTextContent('terminal.workingDirectory')
    expect(bar).toHaveTextContent('/workspace/users/admin/workspace')
  })
})
