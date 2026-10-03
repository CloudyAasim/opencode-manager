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
  FileTree: ({
    files,
    onFileSelect,
    onDirectoryClick,
  }: {
    files: Array<{ name: string; path: string; isDirectory: boolean }>
    onFileSelect: (file: FileInfo) => void
    onDirectoryClick: (path: string) => void
  }) => (
    <div>
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
})
