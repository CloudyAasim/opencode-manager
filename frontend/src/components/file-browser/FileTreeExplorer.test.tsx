import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { FileTreeExplorer } from './FileTreeExplorer'
import type { FileInfo } from '@/types/files'

vi.mock('@/api/files', () => ({
  getFileApiUrl: (path: string) => `/api/files?path=${encodeURIComponent(path)}`,
}))

const node = (partial: Partial<FileInfo> & Pick<FileInfo, 'name' | 'path' | 'isDirectory'>): FileInfo => ({
  size: 0,
  lastModified: new Date(0),
  ...partial,
})

const tree: Record<string, FileInfo> = {
  '': node({
    name: 'root',
    path: '',
    isDirectory: true,
    children: [
      node({ name: 'src', path: 'src', isDirectory: true }),
      node({ name: 'a.txt', path: 'a.txt', isDirectory: false }),
    ],
  }),
  src: node({
    name: 'src',
    path: 'src',
    isDirectory: true,
    children: [node({ name: 'index.ts', path: 'src/index.ts', isDirectory: false })],
  }),
}

const fetchMock = vi.fn()

function jsonResponse(body: unknown, ok = true) {
  return { ok, status: ok ? 200 : 500, json: async () => body }
}

beforeEach(() => {
  fetchMock.mockReset()
  fetchMock.mockImplementation(async (url: string) => {
    const path = new URL(url, 'http://localhost').searchParams.get('path') ?? ''
    const entry = tree[path]
    return entry ? jsonResponse(entry) : jsonResponse({ error: 'not found' }, false)
  })
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('FileTreeExplorer', () => {
  it('loads the root directory and renders indentation guides', async () => {
    render(<FileTreeExplorer rootPath="" onSelectFile={vi.fn()} />)

    expect(await screen.findByText('src')).toBeInTheDocument()
    expect(screen.getByText('a.txt')).toBeInTheDocument()
    expect(screen.getByText('├─')).toBeInTheDocument()
    expect(screen.getByText('└─')).toBeInTheDocument()
  })

  it('lazy-loads a directory only when expanded', async () => {
    render(<FileTreeExplorer rootPath="" onSelectFile={vi.fn()} />)
    await screen.findByText('src')

    expect(fetchMock).not.toHaveBeenCalledWith(expect.stringContaining('path=src'))
    expect(screen.queryByText('index.ts')).not.toBeInTheDocument()

    fireEvent.click(screen.getByText('src').closest('button')!)

    expect(await screen.findByText('index.ts')).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('path=src'))
    expect(screen.getByText(/│\s*└─/)).toBeInTheDocument()
  })

  it('selects files but does not fetch them as directories', async () => {
    const onSelectFile = vi.fn()
    render(<FileTreeExplorer rootPath="" onSelectFile={onSelectFile} />)
    await screen.findByText('a.txt')

    fireEvent.click(screen.getByText('a.txt'))

    expect(onSelectFile).toHaveBeenCalledWith(expect.objectContaining({ path: 'a.txt', isDirectory: false }))
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('shows an error state when the directory cannot be loaded', async () => {
    fetchMock.mockImplementation(async () => jsonResponse({ error: 'nope' }, false))

    render(<FileTreeExplorer rootPath="missing" onSelectFile={vi.fn()} />)

    expect(await screen.findByText('Failed to load files')).toBeInTheDocument()
  })
})
