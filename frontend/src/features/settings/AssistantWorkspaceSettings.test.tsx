import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { AssistantWorkspaceSettings } from './AssistantWorkspaceSettings'

const getAssistantWorkspaceContents = vi.fn()
const deleteFileOrFolder = vi.fn()
const saveFileContent = vi.fn()
const useFile = vi.fn()
const resetAssistantWorkspace = vi.fn()

vi.mock('@/api/repos', () => ({
  getAssistantWorkspaceContents: (id: number) => getAssistantWorkspaceContents(id),
  resetAssistantWorkspace: (id: number) => resetAssistantWorkspace(id),
}))

vi.mock('@/api/files', () => ({
  deleteFileOrFolder: (path: string) => deleteFileOrFolder(path),
  saveFileContent: (path: string, content: string) => saveFileContent(path, content),
  useFile: (path: string | undefined) => useFile(path),
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
    saveFileContent.mockReset()
    useFile.mockReset()
    resetAssistantWorkspace.mockReset()
    getAssistantWorkspaceContents.mockResolvedValue(CONTENTS)
    deleteFileOrFolder.mockResolvedValue({ success: true })
    saveFileContent.mockResolvedValue({})
    resetAssistantWorkspace.mockResolvedValue({})
    useFile.mockReturnValue({ data: { content: '# managed file' }, isLoading: false, isError: false })
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

  it('edits a managed file, which is the half of the panel that was missing', async () => {
    // Previewing a directory the user is invited to maintain, with no way to
    // change anything, is not the feature it looks like. The write goes through
    // the files API, which already accepts this directory.
    const user = userEvent.setup()
    renderPanel()

    await user.click(await screen.findByRole('button', { name: 'Edit AGENTS.md' }))
    const editor = await screen.findByRole('textbox', { name: 'AGENTS.md' })
    await user.clear(editor)
    await user.type(editor, 'fixed')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => {
      expect(saveFileContent).toHaveBeenCalledWith('/w/setting/assistant/AGENTS.md', 'fixed')
    })
  })

  it('offers no editor for a directory', async () => {
    // A directory has nothing to edit, and an editor that silently saved an
    // empty file over one would be worse than not offering it.
    //
    // This is also the only place the "do not read a directory as a file" rule
    // is observable. The guard inside `useFile` cannot be tested on its own:
    // a directory never reaches the editing state while this one holds, so
    // removing it changes nothing you can see. Together, they are the risk -
    // and this assertion is the half of it that fails.
    renderPanel()

    expect(await screen.findByRole('button', { name: 'Edit AGENTS.md' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Edit RelayAB' })).not.toBeInTheDocument()
  })

  it('never hands a directory to the file-reading API', async () => {
    const user = userEvent.setup()
    renderPanel()

    await user.click(await screen.findByRole('button', { name: 'Edit AGENTS.md' }))
    await screen.findByRole('textbox', { name: 'AGENTS.md' })

    for (const [requested] of useFile.mock.calls) {
      expect(requested).not.toBe('/w/setting/assistant/RelayAB')
    }
  })

  it('shortens the directory instead of printing the host layout', async () => {
    // The card header is where the assistant directory is spelled out, and the
    // spelling the server sends carries the account name. This is display only:
    // the paths that are opened and written still go out unmodified.
    renderPanel()

    // Positive - the directory is rendered, and the entries beside it are too,
    // so "the raw path is gone" cannot pass by the panel rendering nothing.
    expect(await screen.findByText('/assistant/')).toBeInTheDocument()
    expect(await screen.findByText('RelayAB')).toBeInTheDocument()
    expect(await screen.findByText('AGENTS.md')).toBeInTheDocument()
    // Reverse - the host layout is not printed anywhere in the panel.
    expect(document.body.textContent).not.toContain('/workspace/users/aasim/setting/assistant')
    expect(document.body.textContent).not.toContain('users/aasim')
  })

  it('still writes and deletes with the real path, not the shortened one', async () => {
    // Shortening the display must not shorten what the tools act on. Both of
    // these assert the raw path reaches the API, which is the part that would
    // break silently if the display helper were used for the calls too.
    const user = userEvent.setup()
    renderPanel()

    await user.click(await screen.findByRole('button', { name: 'Delete RelayAB' }))
    await user.click(await screen.findByRole('button', { name: /delete/i }))
    await waitFor(() => {
      expect(deleteFileOrFolder).toHaveBeenCalledWith('/w/setting/assistant/RelayAB')
    })

    await user.click(await screen.findByRole('button', { name: 'Edit AGENTS.md' }))
    const editor = await screen.findByRole('textbox', { name: 'AGENTS.md' })
    await user.clear(editor)
    await user.type(editor, 'fixed')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => {
      expect(saveFileContent).toHaveBeenCalledWith('/w/setting/assistant/AGENTS.md', 'fixed')
    })
  })

  it('resets the whole assistant directory, behind a confirmation', async () => {
    // The user asked for a way back when the assistant has made a mess of its
    // own folder. It destroys everything in there, so it goes through the
    // shared confirm dialog and the backend, not a local state wipe.
    const user = userEvent.setup()
    renderPanel()

    await user.click(await screen.findByRole('button', { name: 'Reset assistant' }))

    // Nothing is destroyed by merely opening the dialog.
    expect(resetAssistantWorkspace).not.toHaveBeenCalled()

    await user.click(await screen.findByRole('button', { name: 'Reset everything' }))

    await waitFor(() => {
      expect(resetAssistantWorkspace).toHaveBeenCalledWith(0)
    })
  })

  it('can cancel the reset', async () => {
    const user = userEvent.setup()
    renderPanel()

    await user.click(await screen.findByRole('button', { name: 'Reset assistant' }))
    await user.click(await screen.findByRole('button', { name: /cancel/i }))

    await waitFor(() => {
      expect(screen.queryByRole('button', { name: 'Reset everything' })).not.toBeInTheDocument()
    })
    expect(resetAssistantWorkspace).not.toHaveBeenCalled()
  })
})
