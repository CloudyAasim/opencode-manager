import { useQuery } from '@tanstack/react-query'
import { fetchWrapper, fetchWrapperBlob } from './fetchWrapper'
import { API_BASE_URL } from '@/config'
import { saveFile } from '@/lib/download'
import type { FileInfo, ChunkedFileInfo, PatchOperation } from '@/types/files'

interface FileApiUrlOptions {
  route?: string
  params?: Record<string, string | number | boolean | undefined>
}

export function getFileApiUrl(path: string, options: FileApiUrlOptions = {}): string {
  const searchParams = new URLSearchParams()
  Object.entries(options.params ?? {}).forEach(([key, value]) => {
    if (value !== undefined) {
      searchParams.append(key, String(value))
    }
  })

  searchParams.set('path', path)
  const query = searchParams.toString()
  const routePath = options.route ? `/${options.route}` : ''
  return `${API_BASE_URL}/api/files${routePath}${query ? `?${query}` : ''}`
}

async function fetchFile(path: string): Promise<FileInfo> {
  return fetchWrapper(getFileApiUrl(path))
}

export function useFile(path: string | undefined) {
  return useQuery({
    queryKey: ['file', path],
    queryFn: () => path ? fetchFile(path) : Promise.reject(new Error('No file path provided')),
    enabled: !!path,
  })
}

export async function fetchFileRange(path: string, startLine: number, endLine: number): Promise<ChunkedFileInfo> {
  return fetchWrapper(getFileApiUrl(path), {
    params: { startLine, endLine },
  })
}

export async function getIgnoredPaths(path: string): Promise<{ ignoredPaths: string[] }> {
  return fetchWrapper(getFileApiUrl(path, { route: 'ignored-paths' }))
}

export interface DownloadOptions {
  includeGit?: boolean
  includePaths?: string[]
}

export async function downloadDirectoryAsZip(path: string, options?: DownloadOptions): Promise<void> {
  const url = getFileApiUrl(path, {
    route: 'download-zip',
    params: {
      includeGit: options?.includeGit || undefined,
      includePaths: options?.includePaths?.length ? options.includePaths.join(',') : undefined,
    },
  })
  
  const blob = await fetchWrapperBlob(url)
  const dirName = path.split('/').pop() || 'download'
  await saveFile(blob, `${dirName}.zip`)
}

export async function applyFilePatches(path: string, patches: PatchOperation[]): Promise<{ success: boolean; totalLines: number }> {
  const url = getFileApiUrl(path)
  return fetchWrapper(url, {
    method: 'PATCH',
    body: JSON.stringify({ patches }),
  })
}

/**
 * Removes a file or directory. The path is absolute and must be inside one of
 * the caller's allowed roots - the file browser's root and the user's settings
 * directory are both in them, so this also covers the assistant workspace, which
 * is a sibling of the projects directory and therefore unreachable through the
 * browser's own navigation.
 */
export async function deleteFileOrFolder(path: string): Promise<{ success: boolean }> {
  return fetchWrapper(getFileApiUrl(path), { method: 'DELETE' })
}

/**
 * Writes a file's whole contents.
 *
 * `PUT` with a `content` body overwrites even when the file already exists,
 * which is what an editor needs. The patch endpoint only speaks line ranges,
 * and turning "the user typed this" into a range is a way to lose content when
 * the file changed underneath.
 */
export async function saveFileContent(path: string, content: string): Promise<FileInfo> {
  return fetchWrapper(getFileApiUrl(path), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'file', content }),
  })
}
