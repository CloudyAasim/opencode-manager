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

/**
 * `rootPath` here is the real on-disk directory, because that is what
 * `SessionDetail` has to hand over: `repo.fullPath` is
 * `/workspace/users/<name>/workspace/repos/<repo>`.
 *
 * The sidebar used to render that verbatim - and with a leading slash glued on,
 * so it also showed `//workspace/...`. These tests are about what the sidebar
 * *says*; the one that matters most is the last, which pins that the request
 * still carries the real path.
 */
describe('FileTreeExplorer path display', () => {
  const USER_ROOT = '/workspace/users/aasim/workspace'
  const REPO_ROOT = `${USER_ROOT}/repos/RelayAB`
  const ASSISTANT_ROOT = '/workspace/users/aasim/setting/assistant'

  const absoluteTree: Record<string, FileInfo> = {
    [REPO_ROOT]: node({
      name: 'RelayAB',
      path: REPO_ROOT,
      isDirectory: true,
      children: [node({ name: 'README.md', path: `${REPO_ROOT}/README.md`, isDirectory: false })],
    }),
    [ASSISTANT_ROOT]: node({
      name: 'assistant',
      path: ASSISTANT_ROOT,
      isDirectory: true,
      children: [node({ name: 'AGENTS.md', path: `${ASSISTANT_ROOT}/AGENTS.md`, isDirectory: false })],
    }),
  }

  function serveAbsoluteTree() {
    fetchMock.mockImplementation(async (url: string) => {
      const path = new URL(url, 'http://localhost').searchParams.get('path') ?? ''
      const entry = absoluteTree[path]
      return entry ? jsonResponse(entry) : jsonResponse({ error: 'not found' }, false)
    })
  }

  function headerText() {
    return document.querySelector('span.font-mono')?.textContent
  }

  function everyTooltip() {
    return Array.from(document.querySelectorAll('[title]')).map((el) => el.getAttribute('title') ?? '')
  }

  it('shortens a user’s project root to the /workspace form', async () => {
    serveAbsoluteTree()
    render(<FileTreeExplorer rootPath={REPO_ROOT} onSelectFile={vi.fn()} />)
    await screen.findByText('README.md')

    expect(headerText()).toBe('/workspace/repos/RelayAB')
    expect(headerText()).not.toContain('aasim')
  })

  it('shortens the assistant directory the same way', async () => {
    serveAbsoluteTree()
    render(<FileTreeExplorer rootPath={ASSISTANT_ROOT} onSelectFile={vi.fn()} />)
    await screen.findByText('AGENTS.md')

    // A trailing slash is what marks a root, so this is not `/assistant`.
    expect(headerText()).toBe('/assistant/')
  })

  it('shortens the tooltip on each file too', async () => {
    serveAbsoluteTree()
    render(<FileTreeExplorer rootPath={REPO_ROOT} onSelectFile={vi.fn()} />)
    await screen.findByText('README.md')

    expect(everyTooltip()).toContain('/workspace/repos/RelayAB/README.md')
    // The account name is the part that has no business being on screen.
    expect(everyTooltip().some((title) => title.includes('aasim'))).toBe(false)
  })

  it('requests the real path, not the shortened one', async () => {
    serveAbsoluteTree()
    render(<FileTreeExplorer rootPath={REPO_ROOT} onSelectFile={vi.fn()} />)
    await screen.findByText('README.md')

    // Display only. If this ever stops holding, the shortening has started
    // changing what the server is asked for.
    expect(fetchMock).toHaveBeenCalledWith(`/api/files?path=${encodeURIComponent(REPO_ROOT)}`)
  })

  it('selects the file with its real path', async () => {
    serveAbsoluteTree()
    const onSelectFile = vi.fn()
    render(<FileTreeExplorer rootPath={REPO_ROOT} onSelectFile={onSelectFile} />)
    await screen.findByText('README.md')

    fireEvent.click(screen.getByText('README.md'))

    expect(onSelectFile).toHaveBeenCalledWith(
      expect.objectContaining({ path: `${REPO_ROOT}/README.md` }),
    )
  })

  it('leaves a path outside the known layout exactly as it is', async () => {
    // The root itself is the header, so a node has to be waited for here.
    fetchMock.mockImplementation(async () =>
      jsonResponse(
        node({
          name: 'thing',
          path: '/opt/custom/thing',
          isDirectory: true,
          children: [node({ name: 'notes.txt', path: '/opt/custom/thing/notes.txt', isDirectory: false })],
        }),
      ),
    )
    render(<FileTreeExplorer rootPath="/opt/custom/thing" onSelectFile={vi.fn()} />)
    await screen.findByText('notes.txt')

    // There is no such layout as `/opt/users/<name>/workspace`, so rewriting it
    // would put a path on screen that does not exist.
    expect(headerText()).toBe('/opt/custom/thing')
  })

  it('shows a bare slash when there is no root', async () => {
    render(<FileTreeExplorer rootPath="" onSelectFile={vi.fn()} />)
    await screen.findByText('src')

    expect(headerText()).toBe('/')
  })
})
