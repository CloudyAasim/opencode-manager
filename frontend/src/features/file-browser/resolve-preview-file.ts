import { getFileApiUrl } from '@/api/files'
import type { FileInfo } from '@/types/files'

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
