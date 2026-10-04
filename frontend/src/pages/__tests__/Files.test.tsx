import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Files } from '../Files'
import type { FileInfo } from '@/types/files'

const fetchMock = vi.hoisted(() => vi.fn())
const useMobileMock = vi.hoisted(() => vi.fn(() => false))

vi.mock('@/hooks/useMobile', () => ({
  useMobile: useMobileMock,
  useSwipeBack: () => ({ bind: () => undefined, swipeStyles: {} }),
}))

vi.stubGlobal('fetch', (...args: unknown[]) => fetchMock(...args))

vi.mock('@/features/file-browser/FileTree', () => ({
  // The up row is part of the real component's contract, so the mock has to
  // have one too - without it there is no way to reach the assistant
  // directory from the test, which is a sibling of the workspace rather than a
  // child of it.
  FileTree: ({
    files,
    onFileSelect,
    onDirectoryClick,
    onNavigateUp,
    canNavigateUp,
  }: {
    files: Array<{ name: string; path: string; isDirectory: boolean }>
    onFileSelect: (file: FileInfo) => void
    onDirectoryClick: (path: string) => void
    onNavigateUp?: () => void
    canNavigateUp?: boolean
  }) => (
    <div>
      {canNavigateUp ? (
        <button type="button" data-testid="up" onClick={() => onNavigateUp?.()}>
          ..
        </button>
      ) : null}
      {files.map((file) => (
        <button
          key={file.path}
          type="button"
          onClick={() => (file.isDirectory ? onDirectoryClick(file.path) : onFileSelect(file as FileInfo))}
        >
          {file.name}
        </button>
      ))}
    </div>
  ),
}))

vi.mock('@/features/file-browser/FilePreview', () => ({
  FilePreview: ({ file }: { file: FileInfo }) => <div data-testid="preview">{file.path}</div>,
}))

vi.mock('@/features/file-browser/MobileFilePreviewModal', () => ({
  MobileFilePreviewModal: ({ isOpen, file }: { isOpen: boolean; file: FileInfo | null }) => (
    <div data-testid="mobile-preview">{`${String(isOpen)}|${file?.path ?? 'null'}`}</div>
  ),
}))

const LISTING = {
  name: '',
  path: '',
  isDirectory: true,
  workspaceRoot: '/workspace',
  children: [
    { name: 'src', path: 'src', isDirectory: true, children: [] },
    { name: 'a.txt', path: 'a.txt', isDirectory: false, size: 1, lastModified: new Date(0) },
  ],
}

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
}

function wrapper({ children }: { children: React.ReactNode }) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return (
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/files']}>
        <Routes>
          <Route path="/files" element={children} />
          <Route path="/" element={<div>home</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  )
}

describe('Files page', () => {
  beforeEach(() => {
    useMobileMock.mockReturnValue(false)
    fetchMock.mockReset()
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('path=a.txt')) {
        return jsonResponse({ name: 'a.txt', path: 'a.txt', isDirectory: false, size: 1, lastModified: new Date(0) })
      }
      return jsonResponse(LISTING)
    })
  })

  afterEach(() => {
    fetchMock.mockReset()
  })

  it('loads the root listing and offers no back control', async () => {
    // /files is a top-level page: there is nothing behind it to return to, and
    // a control that navigates back to / is a dead end on a fresh tab.
    render(<Files />, { wrapper })

    await waitFor(() => {
      expect(screen.getByText('a.txt')).toBeInTheDocument()
    })
    expect(screen.queryByRole('button', { name: /back|返回/i })).not.toBeInTheDocument()
  })

  it('opens a full-screen preview for a picked file on narrow viewports', async () => {
    useMobileMock.mockReturnValue(true)
    render(<Files />, { wrapper })

    await waitFor(() => {
      expect(screen.getByText('a.txt')).toBeInTheDocument()
    })
    fireEvent.click(screen.getByText('a.txt'))

    await waitFor(() => {
      expect(screen.getByTestId('mobile-preview').textContent).toBe('true|a.txt')
    })
  })

  it('previews inline on wide viewports instead of opening the modal', async () => {
    render(<Files />, { wrapper })

    await waitFor(() => {
      expect(screen.getByText('a.txt')).toBeInTheDocument()
    })
    fireEvent.click(screen.getByText('a.txt'))

    await waitFor(() => {
      expect(screen.getByTestId('preview')).toHaveTextContent('a.txt')
    })
    expect(screen.getByTestId('mobile-preview').textContent).toBe('false|a.txt')
  })

  it('lists directories returned for the root', async () => {
    render(<Files />, { wrapper })

    await waitFor(() => {
      expect(screen.getByText('src')).toBeInTheDocument()
    })
  })

  it('shows the header as /workspace/ for a normal user', async () => {
    // End to end on purpose. The first version of this feature unit tested the
    // mapping and component tested the component, and the header still looked
    // unchanged - because the page never passed the browse root down, so the
    // mapping had a relative path it could not resolve. Only a test that goes
    // through the page sees that.
    fetchMock.mockImplementation(async () =>
      jsonResponse({ ...LISTING, workspaceRoot: '/workspace/users/aasim/workspace' }),
    )
    render(<Files />, { wrapper })

    await waitFor(() => {
      expect(screen.getByText('a.txt')).toBeInTheDocument()
    })
    expect(screen.getByText('/workspace/')).toBeInTheDocument()
  })

  it('asks the server once, not once per render', async () => {
    // `onDirectoryLoad` sits in the dependencies of the controller's
    // `loadFiles` callback, and the initial-load effect depends on that too.
    // Passing it an inline arrow function re-created `loadFiles` on every
    // render, so the effect reloaded the root for ever - a request storm on
    // the main files page, and one that a test reading the screen never sees,
    // because the screen looks correct the whole time.
    render(<Files />, { wrapper })

    await waitFor(() => {
      expect(screen.getByText('a.txt')).toBeInTheDocument()
    })
    const settled = fetchMock.mock.calls.length
    await new Promise((resolve) => setTimeout(resolve, 200))
    expect(fetchMock.mock.calls.length).toBe(settled)
  })

  // The `/assistant/` case is covered in FileBrowserSheet.test.tsx, which
  // renders the real file tree. This file mocks FileTree, and driving
  // navigation through an invented mock contract would have been testing the
  // mock rather than the header.
})
