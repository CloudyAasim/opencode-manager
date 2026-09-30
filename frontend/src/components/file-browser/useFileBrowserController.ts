import { useCallback, useEffect, useRef, useState } from 'react'
import { useI18n } from '@/lib/i18n'
import { useMobile } from '@/hooks/useMobile'
import { getFileApiUrl, useFile } from '@/api/files'
import type { FileInfo, UploadItem, UploadProgress } from '@/types/files'

export interface FileBrowserControllerOptions {
  basePath?: string
  initialSelectedFile?: string
  onFileSelect?: (file: FileInfo) => void
  onDirectoryLoad?: (info: { workspaceRoot?: string; currentPath: string }) => void
  onPreviewStateChange?: (open: boolean) => void
  allowNavigateAboveBase?: boolean
}

export interface FileBrowserController {
  currentPath: string
  files: FileInfo | null
  selectedFile: FileInfo | null
  searchQuery: string
  setSearchQuery: (q: string) => void
  loading: boolean
  error: string | null
  setError: (msg: string | null) => void
  isPreviewModalOpen: boolean
  uploadProgress: UploadProgress | null
  loadFiles: (path: string) => Promise<void>
  navigateUp: () => void
  canNavigateUp: () => boolean
  selectFile: (file: FileInfo) => Promise<void>
  closePreview: () => void
  create: (name: string, type: 'file' | 'folder') => Promise<void>
  rename: (oldPath: string, newPath: string) => Promise<void>
  remove: (path: string) => Promise<void>
  copy: (sourcePath: string, newPath: string) => Promise<void>
  upload: (files: FileList) => Promise<void>
  cancelUpload: () => void
  expandedPaths: Set<string>
  isExpanded: (path: string) => boolean
  toggleDirectory: (path: string) => void
  loadChildren: (path: string) => Promise<void>
  isDragging: boolean
  dragHandlers: {
    onDragEnter: (e: React.DragEvent) => void
    onDragLeave: (e: React.DragEvent) => void
    onDragOver: (e: React.DragEvent) => void
    onDrop: (e: React.DragEvent) => void
  }
  dropZoneRef: React.RefObject<HTMLDivElement | null>
}

export function useFileBrowserController(options: FileBrowserControllerOptions): FileBrowserController {
  const { t } = useI18n()
  const isMobile = useMobile()
  const {
    basePath = '',
    initialSelectedFile,
    onFileSelect,
    onDirectoryLoad,
    onPreviewStateChange,
    allowNavigateAboveBase = false,
  } = options

  const [currentPath, setCurrentPath] = useState(basePath)
  const [files, setFiles] = useState<FileInfo | null>(null)
  const [selectedFile, setSelectedFile] = useState<FileInfo | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [isPreviewModalOpen, setIsPreviewModalOpen] = useState(false)
  const [uploadProgress, setUploadProgress] = useState<UploadProgress | null>(null)
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(() => new Set())
  const loadedChildrenRef = useRef<Set<string>>(new Set())

  const dropZoneRef = useRef<HTMLDivElement>(null)
  const uploadCancelledRef = useRef(false)

  const { data: initialFileData, error: initialFileError } = useFile(initialSelectedFile)

  useEffect(() => {
    if (initialFileData) {
      setSelectedFile(initialFileData)
      if (isMobile) onPreviewStateChange?.(true)
    }
  }, [initialFileData, isMobile, onPreviewStateChange])

  useEffect(() => {
    if (initialFileError) {
      setError(initialFileError.message)
    }
  }, [initialFileError])

  const loadFiles = useCallback(
    async (path: string) => {
      setLoading(true)
      setError(null)
      try {
        const response = await fetch(getFileApiUrl(path))
        if (!response.ok) {
          throw new Error(t('repo.fileBrowser.errors.loadFiles', { status: response.statusText }))
        }
        const data = await response.json()
        setFiles(data)
        setCurrentPath(path)
        loadedChildrenRef.current = new Set()
        setExpandedPaths(new Set())
        onDirectoryLoad?.({ workspaceRoot: data.workspaceRoot, currentPath: path })
      } catch (err) {
        setError(err instanceof Error ? err.message : t('repo.fileBrowser.errors.loadFilesGeneric'))
      } finally {
        setLoading(false)
      }
    },
    [onDirectoryLoad, t],
  )

  const normalizePath = useCallback((path: string): string => {
    const normalized = path.trim().replace(/\\/g, '/').replace(/\/+/g, '/').replace(/\/+$/, '')
    if (normalized === '.' || normalized === './') return ''
    if (normalized.startsWith('./')) return normalized.slice(2)
    return normalized
  }, [])

  const getPathParts = useCallback(
    (path: string) => normalizePath(path).split('/').filter(Boolean),
    [normalizePath],
  )

  useEffect(() => {
    void loadFiles(basePath)
  }, [basePath, loadFiles])

  const canNavigateUp = useCallback(() => {
    if (allowNavigateAboveBase && normalizePath(currentPath) === '') return true
    if (normalizePath(currentPath) === '..') return false
    const pathParts = getPathParts(currentPath)
    if (allowNavigateAboveBase) return pathParts.length > 0
    return pathParts.length > 0 && normalizePath(currentPath) !== normalizePath(basePath)
  }, [allowNavigateAboveBase, basePath, currentPath, getPathParts, normalizePath])

  const navigateUp = useCallback(() => {
    if (allowNavigateAboveBase && normalizePath(currentPath) === '') {
      loadFiles('..')
      return
    }
    const pathParts = getPathParts(currentPath)
    if (pathParts.length > 0) {
      pathParts.pop()
      const parentPath = pathParts.join('/')
      loadFiles(allowNavigateAboveBase ? parentPath : parentPath || basePath)
    }
  }, [allowNavigateAboveBase, basePath, currentPath, loadFiles, getPathParts, normalizePath])

  const toggleDirectory = useCallback((path: string) => {
    setExpandedPaths((current) => {
      if (current.has(path)) {
        const next = new Set(current)
        next.delete(path)
        return next
      }
      const next = new Set(current)
      next.add(path)
      return next
    })
  }, [])

  const loadChildren = useCallback(
    async (path: string): Promise<void> => {
      if (!path || loadedChildrenRef.current.has(path)) return
      loadedChildrenRef.current.add(path)
      try {
        const response = await fetch(getFileApiUrl(path))
        if (!response.ok) return
        const listing = (await response.json()) as FileInfo
        if (!listing.isDirectory) return
        setFiles((current) =>
          current
            ? { ...current, children: mergeChildren(rootsOf(current), path, listing.children ?? []) }
            : current,
        )
      } catch {
        loadedChildrenRef.current.delete(path)
      }
    },
    [],
  )

  const isExpanded = useCallback((path: string) => expandedPaths.has(path), [expandedPaths])

  const closePreview = useCallback(() => {
    setIsPreviewModalOpen(false)
    setSelectedFile(null)
    onPreviewStateChange?.(false)
  }, [onPreviewStateChange])

  const selectFile = useCallback(
    async (file: FileInfo) => {
      if (file.isDirectory) {
        setSelectedFile(null)
        return
      }
      setLoading(true)
      try {
        const response = await fetch(getFileApiUrl(file.path))
        if (!response.ok) {
          throw new Error(t('repo.fileBrowser.errors.loadFile', { status: response.statusText }))
        }
        const fullFileData: FileInfo = await response.json()
        setSelectedFile(fullFileData)
        onFileSelect?.(fullFileData)
        if (isMobile) {
          setIsPreviewModalOpen(true)
          onPreviewStateChange?.(true)
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : t('repo.fileBrowser.errors.loadFileGeneric'))
        setSelectedFile(null)
      } finally {
        setLoading(false)
      }
    },
    [isMobile, onFileSelect, onPreviewStateChange, t],
  )

  const create = useCallback(
    async (name: string, type: 'file' | 'folder') => {
      try {
        const target = [currentPath, name].filter(Boolean).join('/')
        const response = await fetch(getFileApiUrl(target), {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type, content: type === 'file' ? '' : undefined }),
        })
        if (!response.ok) throw new Error(t('repo.fileBrowser.errors.create', { status: response.statusText }))
        await loadFiles(currentPath)
      } catch (err) {
        setError(err instanceof Error ? err.message : t('repo.fileBrowser.errors.createGeneric'))
      }
    },
    [currentPath, loadFiles, t],
  )

  const remove = useCallback(
    async (path: string) => {
      try {
        const response = await fetch(getFileApiUrl(path), { method: 'DELETE' })
        if (!response.ok) throw new Error(t('repo.fileBrowser.errors.delete', { status: response.statusText }))
        await loadFiles(currentPath)
        setSelectedFile(null)
      } catch (err) {
        setError(err instanceof Error ? err.message : t('repo.fileBrowser.errors.deleteGeneric'))
      }
    },
    [currentPath, loadFiles, t],
  )

  const rename = useCallback(
    async (oldPath: string, newPath: string) => {
      try {
        const response = await fetch(getFileApiUrl(oldPath), {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ newPath }),
        })
        if (!response.ok) throw new Error(t('repo.fileBrowser.errors.rename', { status: response.statusText }))
        await loadFiles(currentPath)
      } catch (err) {
        setError(err instanceof Error ? err.message : t('repo.fileBrowser.errors.renameGeneric'))
      }
    },
    [currentPath, loadFiles, t],
  )

  const copy = useCallback(
    async (sourcePath: string, newPath: string) => {
      try {
        const response = await fetch(getFileApiUrl(sourcePath), {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ newPath, operation: 'copy' }),
        })
        if (!response.ok) {
          const body = await response.json().catch(() => null)
          throw new Error(body?.error ?? t('repo.fileBrowser.errors.copy', { status: response.statusText }))
        }
        await loadFiles(currentPath)
      } catch (err) {
        setError(err instanceof Error ? err.message : t('repo.fileBrowser.errors.copyGeneric'))
      }
    },
    [currentPath, loadFiles, t],
  )

  const uploadSingleFile = useCallback(
    async (item: UploadItem): Promise<string | null> => {
      const formData = new FormData()
      formData.append('file', item.file)
      formData.append('relativePath', item.relativePath)
      try {
        const response = await fetch(getFileApiUrl(currentPath), {
          method: 'POST',
          body: formData,
        })
        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}))
          return errorData.error || t('repo.fileBrowser.errors.upload', { status: response.statusText })
        }
        return null
      } catch (err) {
        return err instanceof Error ? err.message : t('repo.fileBrowser.errors.uploadGeneric')
      }
    },
    [currentPath, t],
  )

  const upload = useCallback(
    async (fileList: FileList) => {
      const items = getUploadItemsFromFileList(fileList)
      if (items.length === 0) return
      uploadCancelledRef.current = false
      const errors: string[] = []
      setUploadProgress({
        current: 0,
        total: items.length,
        currentFile: items[0].relativePath,
        errors: [],
        cancelled: false,
      })
      for (let i = 0; i < items.length; i += 1) {
        if (uploadCancelledRef.current) {
          setUploadProgress((prev: UploadProgress | null) => (prev ? { ...prev, cancelled: true } : null))
          break
        }
        const item = items[i]
        setUploadProgress((prev: UploadProgress | null) =>
          prev ? { ...prev, current: i, currentFile: item.relativePath } : null,
        )
        const error = await uploadSingleFile(item)
        if (error) errors.push(`${item.relativePath}: ${error}`)
      }
      setUploadProgress((prev: UploadProgress | null) =>
        prev ? { ...prev, current: items.length, errors, cancelled: uploadCancelledRef.current } : null,
      )
      await loadFiles(currentPath)
    },
    [currentPath, uploadSingleFile, loadFiles],
  )

  const cancelUpload = useCallback(() => {
    uploadCancelledRef.current = true
  }, [])

  const dragHandlers = {
    onDragEnter: (e: React.DragEvent) => {
      e.preventDefault()
      e.stopPropagation()
      setIsDragging(true)
    },
    onDragLeave: (e: React.DragEvent) => {
      e.preventDefault()
      e.stopPropagation()
      if (e.currentTarget === dropZoneRef.current) {
        const related = e.relatedTarget as Node | null
        if (!related || !dropZoneRef.current?.contains(related)) setIsDragging(false)
      }
    },
    onDragOver: (e: React.DragEvent) => {
      e.preventDefault()
      e.stopPropagation()
    },
    onDrop: (e: React.DragEvent) => {
      e.preventDefault()
      e.stopPropagation()
      setIsDragging(false)
      const items = e.dataTransfer.items
      void upload(items.length > 0 ? (items as unknown as FileList) : e.dataTransfer.files)
    },
  }

  return {
    currentPath,
    files,
    selectedFile,
    searchQuery,
    setSearchQuery,
    loading,
    error,
    setError,
    isPreviewModalOpen,
    uploadProgress,
    loadFiles,
    navigateUp,
    canNavigateUp,
    selectFile,
    closePreview,
    create,
    rename,
    remove,
    copy,
    upload,
    cancelUpload,
    expandedPaths,
    isExpanded,
    toggleDirectory,
    loadChildren,
    isDragging,
    dragHandlers,
    dropZoneRef,
  }
}

function mergeChildren(roots: FileInfo[], path: string, children: FileInfo[]): FileInfo[] {
  const walk = (nodes: FileInfo[]): FileInfo[] =>
    nodes.map((node) => {
      if (node.path === path) return { ...node, children }
      if (node.children) return { ...node, children: walk(node.children) }
      return node
    })

  return walk(roots)
}

function rootsOf(files: FileInfo | null): FileInfo[] {
  if (!files) return []
  if (files.isDirectory) return files.children ?? []
  return [files]
}

function getUploadItemsFromFileList(fileList: FileList | DataTransferItemList): UploadItem[] {
  const entries: File[] =
    'length' in fileList && !('add' in fileList)
      ? Array.from(fileList as FileList)
      : Array.from(fileList as DataTransferItemList)
          .map((item) => (item as DataTransferItem).getAsFile())
          .filter((file): file is File => file !== null)

  const items: UploadItem[] = []
  const seen = new Set<string>()
  for (const entry of entries) {
    if (seen.has(entry.name)) continue
    seen.add(entry.name)
    items.push({ file: entry, relativePath: entry.name })
  }
  return items
}
