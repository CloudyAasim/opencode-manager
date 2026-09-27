import { getFileApiUrl } from '@/api/files'
import type { FileInfo } from '@/types/files'

/**
 * Directory listings omit `mimeType`/`content`, so a node picked from a tree
 * cannot be previewed as-is. Fetch the single file to resolve its metadata
 * (and content) before handing it to the preview. Already-resolved files and
 * directories are returned unchanged.
 */
export async function resolvePreviewFile(file: FileInfo): Promise<FileInfo> {
  if (file.isDirectory || file.mimeType !== undefined) return file
  try {
    const response = await fetch(getFileApiUrl(file.path))
    if (!response.ok) return file
    return (await response.json()) as FileInfo
  } catch {
    return file
  }
}
