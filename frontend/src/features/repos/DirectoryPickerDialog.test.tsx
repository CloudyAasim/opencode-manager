import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { DirectoryPickerDialog } from './DirectoryPickerDialog'
import { browseDirectory } from '@/api/filesystem'

vi.mock('@/api/filesystem', () => ({ browseDirectory: vi.fn() }))

/**
 * The header of this dialog is a path line with a tooltip, and the path the
 * browse endpoint returns is the server's absolute layout. Both the line and
 * the tooltip go through `toDisplayPath`.
 *
 * "Select This Folder" is the half that must not move: it hands the path to
 * the caller, and every caller needs the real one.
 */

const REAL_PATH = '/workspace/users/aasim/workspace/repos/RelayAB'
const DISPLAY_PATH = '/workspace/repos/RelayAB'

function listing(path: string) {
  return {
    path,
    parentPath: '/workspace/users/aasim/workspace/repos',
    isRoot: false,
    entries: [{ name: 'docs', path: `${path}/docs`, isGitRepo: false }],
  }
}

function renderPicker(onSelect = vi.fn()) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
  const onOpenChange = vi.fn()
  render(
    <DirectoryPickerDialog open onOpenChange={onOpenChange} onSelect={onSelect} />,
    { wrapper: Wrapper },
  )
  return { onSelect, onOpenChange }
}

describe('DirectoryPickerDialog', () => {
  beforeEach(() => {
    vi.mocked(browseDirectory).mockReset()
  })

  it('shortens the browsed path in the header, and still lists the entries', async () => {
    vi.mocked(browseDirectory).mockResolvedValue(listing(REAL_PATH))
    renderPicker()

    // Positive: the path is rendered and the listing beside it is rendered, so
    // "the raw path is gone" cannot pass by the header rendering nothing.
    expect(await screen.findByText(DISPLAY_PATH)).toBeInTheDocument()
    expect(await screen.findByText('docs')).toBeInTheDocument()
    // Reverse: the header and its tooltip both carry the shortened path only.
    expect(screen.queryByText(REAL_PATH)).not.toBeInTheDocument()
    expect(screen.getByTitle(DISPLAY_PATH)).toBeInTheDocument()
    expect(screen.queryByTitle(REAL_PATH)).not.toBeInTheDocument()
    expect(document.body.textContent).not.toContain('users/aasim')
  })

  it('selects the real path, not the shortened one', async () => {
    // Display only. The caller of `onSelect` uses this to set a working
    // directory, so handing back the shortened form would break the write.
    vi.mocked(browseDirectory).mockResolvedValue(listing(REAL_PATH))
    const user = userEvent.setup()
    const { onSelect, onOpenChange } = renderPicker()

    await user.click(await screen.findByRole('button', { name: 'Select This Folder' }))

    await waitFor(() => {
      expect(onSelect).toHaveBeenCalledWith(REAL_PATH)
    })
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('leaves a directory outside the managed roots spelled as it is', async () => {
    // `toDisplayPath` only rewrites the two roots the user navigates by.
    // Shortening anything else would show a path that does not exist.
    vi.mocked(browseDirectory).mockResolvedValue(listing('/opt/shared/checkout'))
    renderPicker()

    expect(await screen.findByText('/opt/shared/checkout')).toBeInTheDocument()
    expect(screen.getByTitle('/opt/shared/checkout')).toBeInTheDocument()
    expect(screen.queryByText('/opt/shared')).not.toBeInTheDocument()
  })

  it('says it is loading, rather than a shortened slash, before the listing arrives', async () => {
    // A `toDisplayPath` call on an absent path would render `/`, which looks
    // like a real answer. The loading copy is what the user should see.
    vi.mocked(browseDirectory).mockReturnValue(new Promise(() => {}))
    renderPicker()

    expect(await screen.findByText('Loading...')).toBeInTheDocument()
    expect(screen.queryByText('/')).not.toBeInTheDocument()
    expect(document.body.textContent).not.toContain('users/aasim')
  })
})
