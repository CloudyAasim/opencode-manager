import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { resolvePreviewFile } from './resolve-preview-file'
import type { FileInfo } from '@/types/files'

vi.mock('@/api/files', () => ({
  getFileApiUrl: (path: string) => `/api/files?path=${encodeURIComponent(path)}`,
}))

const listingNode: FileInfo = {
  name: 'AGENTS.md',
  path: '/workspace/users/a/assistant/AGENTS.md',
  isDirectory: false,
  size: 536,
  lastModified: new Date(0),
}

const resolvedNode: FileInfo = {
  ...listingNode,
  mimeType: 'text/markdown',
  content: 'IyBBc3Npc3RhbnQ',
}

const directoryNode: FileInfo = {
  name: 'assistant',
  path: '/workspace/users/a/assistant',
  isDirectory: true,
  size: 0,
  lastModified: new Date(0),
}

const fetchMock = vi.fn()
const response = (body: unknown, ok = true) => ({ ok, status: ok ? 200 : 500, json: async () => body })

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('resolvePreviewFile', () => {
  it('fetches the single file when the listing node has no mimeType', async () => {
    fetchMock.mockResolvedValue(response(resolvedNode))

    const result = await resolvePreviewFile(listingNode)

    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining(encodeURIComponent(listingNode.path)))
    expect(result.mimeType).toBe('text/markdown')
    expect(result.content).toBe('IyBBc3Npc3RhbnQ')
  })

  it('returns an already-resolved file without fetching', async () => {
    const result = await resolvePreviewFile(resolvedNode)

    expect(result).toBe(resolvedNode)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('never fetches directories', async () => {
    const result = await resolvePreviewFile(directoryNode)

    expect(result).toBe(directoryNode)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('falls back to the listing node when the fetch fails', async () => {
    fetchMock.mockResolvedValue(response({ error: 'nope' }, false))

    const result = await resolvePreviewFile(listingNode)

    expect(result).toBe(listingNode)
  })
})
