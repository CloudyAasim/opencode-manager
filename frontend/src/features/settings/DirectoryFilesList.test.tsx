import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, it, expect, vi } from 'vitest'
import { DirectoryFilesList } from './DirectoryFilesList'

vi.mock('@/api/settings', () => ({
  settingsApi: {
    getOpenCodeDirectoryFile: vi.fn().mockResolvedValue({ content: '# file' }),
    updateOpenCodeDirectoryFile: vi.fn().mockResolvedValue(undefined),
    deleteOpenCodeDirectoryFile: vi.fn().mockResolvedValue(undefined),
  },
}))

describe('DirectoryFilesList', () => {
  it('labels the raw file editor with the full file path', async () => {
    const user = userEvent.setup()
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })

    render(
      <QueryClientProvider client={queryClient}>
        <DirectoryFilesList
          kind="agents"
          files={[{ kind: 'agents', name: 'planner', relativePath: 'team/planner.md' }]}
        />
      </QueryClientProvider>,
    )

    await user.click(screen.getByText('planner'))
    expect(await screen.findByRole('textbox', { name: 'team/planner.md' })).toBeInTheDocument()
  })
})
