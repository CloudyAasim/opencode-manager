import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { AssistantWorkspaceSettings } from './AssistantWorkspaceSettings'

const getAssistantWorkspaceContents = vi.fn()
const deleteFileOrFolder = vi.fn()

vi.mock('@/api/repos', () => ({
  getAssistantWorkspaceContents: (id: number) => getAssistantWorkspaceContents(id),
}))

vi.mock('@/api/files', () => ({
  deleteFileOrFolder: (path: string) => deleteFileOrFolder(path),
}))

const CONTENTS = {
  directory: '/workspace/users/aasim/setting/assistant',
  totalSizeBytes: 1024 * 1024 * 3,
  truncated: false,
  entries: [
    { name: 'AGENTS.md', path: '/w/setting/assistant/AGENTS.md', isDirectory: false, isManaged: true, sizeBytes: 1024 },
    {
      name: 'RelayAB',
      path: '/w/setting/assistant/RelayAB',
      isDirectory: true,
      isManaged: false,
      sizeBytes: 1024 * 1024 * 3,
    },
  ],
}

function renderPanel() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <AssistantWorkspaceSettings />
    </QueryClientProvider>,
  )
}

describe('AssistantWorkspaceSettings', () => {
  beforeEach(() => {
    getAssistantWorkspaceContents.mockReset()
    deleteFileOrFolder.mockReset()
    getAssistantWorkspaceContents.mockResolvedValue(CONTENTS)
    deleteFileOrFolder.mockResolvedValue({ success: true })
  })

  it('lists what is in the directory, with its size', async () => {
    renderPanel()

    // Without this, "RelayAB is not listed" would also pass if the panel never
    // rendered anything at all.
    expect(await screen.findByText('RelayAB')).toBeInTheDocument()
    expect(await screen.findByText('AGENTS.md')).toBeInTheDocument()
    expect(await screen.findByText('1.0 KB')).toBeInTheDocument()
    // "3.0 MB" shows twice on purpose - once as the directory total, once on
    // the RelayAB row - and asserting the count is what makes this fail if
    // either of them stops being rendered.
    await waitFor(() => {
      expect(screen.getAllByText('3.0 MB')).toHaveLength(2)
    })
  })

  it('deletes an entry through the files API, which already accepts this directory', async () => {
    const user = userEvent.setup()
    renderPanel()

    await user.click(await screen.findByRole('button', { name: 'Delete RelayAB' }))
    const confirm = await screen.findByRole('button', { name: /delete/i })
    await user.click(confirm)

    await waitFor(() => {
      expect(deleteFileOrFolder).toHaveBeenCalledWith('/w/setting/assistant/RelayAB')
    })
  })

  it('says an empty directory is empty rather than showing an error', async () => {
    getAssistantWorkspaceContents.mockResolvedValue({
      directory: '/w/setting/assistant',
      entries: [],
      totalSizeBytes: 0,
      truncated: false,
    })
    renderPanel()

    expect(await screen.findByText('The assistant workspace is empty.')).toBeInTheDocument()
  })
})
