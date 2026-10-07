import { useState, memo, useCallback, useMemo } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import {
  ChevronRight,
  ChevronDown,
  Folder,
  FolderOpen,
  File,
  MoreVertical,
  Trash2,
  Edit3,
  Download,
  Copy,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { DeleteDialog } from '@/components/ui/delete-dialog'
import { useMobile } from '@/hooks/useMobile'
import { API_BASE_URL } from '@/config'
import { cn } from '@/lib/utils'
import { useI18n } from '@/lib/i18n'
import type { FileInfo } from '@/types/files'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

export interface FileTreeProps {
  files: FileInfo[]
  onFileSelect?: (file: FileInfo) => void
  selectedFile?: FileInfo | null
  onDelete?: (path: string) => void
  onRename?: (oldPath: string, newPath: string) => void
  onCopy?: (sourcePath: string, newPath: string) => void
  currentPath?: string
  basePath?: string
  onNavigateUp?: () => void
  canNavigateUp?: boolean
  scrollRef?: React.RefObject<HTMLElement | null>
  virtualizationThreshold?: number
  expandedPaths: Set<string>
  onToggleDirectory: (path: string) => void
  onLoadChildren?: (path: string) => void
}

interface FlatRow {
  file: FileInfo
  level: number
  expandable: boolean
  expanded: boolean
  hasChildren: boolean
}

const FILE_ICON_MAP: Record<string, string> = {
  js: '🟨',
  ts: '🔷',
  jsx: '🟨',
  tsx: '🔷',
  json: '📋',
  md: '📝',
  html: '🌐',
  css: '🎨',
  png: '🖼️',
  jpg: '🖼️',
  jpeg: '🖼️',
  gif: '🖼️',
  svg: '🖼️',
  pdf: '📄',
  zip: '📦',
}

function flattenTree(
  files: FileInfo[],
  expanded: Set<string>,
  level = 0,
  out: FlatRow[] = [],
): FlatRow[] {
  for (const file of files) {
    const hasChildren = file.isDirectory && (file.children?.length ?? 0) > 0
    const isExpanded = hasChildren && expanded.has(file.path)
    out.push({ file, level, expandable: file.isDirectory, expanded: isExpanded, hasChildren })
    if (isExpanded && file.children) {
      flattenTree(file.children, expanded, level + 1, out)
    }
  }
  return out
}

export const FileTree = memo(function FileTree({
  files,
  onFileSelect,
  selectedFile,
  onDelete,
  onRename,
  onCopy,
  currentPath = '',
  basePath = '',
  onNavigateUp,
  canNavigateUp,
  scrollRef,
  virtualizationThreshold = 60,
  expandedPaths,
  onToggleDirectory,
  onLoadChildren,
}: FileTreeProps) {
  const { t } = useI18n()
  const isMobile = useMobile()
  const [editingPath, setEditingPath] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [copyingPath, setCopyingPath] = useState<string | null>(null)
  const [copyName, setCopyName] = useState('')
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null)

  const handleGoUp = useCallback(() => {
    onNavigateUp?.()
  }, [onNavigateUp])

  const showGoUp = canNavigateUp ?? Boolean(currentPath && currentPath !== basePath)

  const rows = useMemo(
    () => flattenTree(files, expandedPaths),
    [files, expandedPaths],
  )

  const toggle = useCallback(
    (path: string) => {
      const row = rows.find((candidate) => candidate.file.path === path)
      const willExpand = !expandedPaths.has(path)
      onToggleDirectory(path)
      if (willExpand && !row?.hasChildren) void onLoadChildren?.(path)
    },
    [rows, expandedPaths, onToggleDirectory, onLoadChildren],
  )

  const virtualEnabled = Boolean(scrollRef) && rows.length >= virtualizationThreshold

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef?.current ?? null,
    estimateSize: () => 34,
    getItemKey: (index) => (rows[index]?.file.path ?? index),
    overscan: 12,
    enabled: virtualEnabled,
  })

  const startRename = useCallback((file: FileInfo) => {
    setEditingPath(file.path)
    setEditName(file.name)
    setCopyingPath(null)
  }, [])

  const submitRename = useCallback(() => {
    if (editingPath && editName && editName !== editNameFromPath(editingPath)) {
      onRename?.(editingPath, replaceName(editingPath, editName))
    }
    setEditingPath(null)
  }, [editingPath, editName, onRename])

  const startCopy = useCallback((file: FileInfo) => {
    setCopyingPath(file.path)
    setCopyName(`${file.name}-copy`)
    setEditingPath(null)
  }, [])

  const submitCopy = useCallback(() => {
    if (copyingPath && copyName && copyName !== nameFromPath(copyingPath)) {
      onCopy?.(copyingPath, replaceName(copyingPath, copyName))
    }
    setCopyingPath(null)
    setCopyName('')
  }, [copyingPath, copyName, onCopy])

  const renderRow = useCallback(
    (row: FlatRow) => {
      const { file } = row
      const isEditing = editingPath === file.path
      const isCopying = copyingPath === file.path

      const menu = isEditing || isCopying ? null : (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className={cn('w-6 h-6 p-0 shrink-0', isMobile ? 'opacity-100' : 'opacity-0 group-hover:opacity-100')}
              aria-label={t('repo.fileBrowser.actions.more')}
            >
              <MoreVertical className="w-3 h-3" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            {!file.isDirectory && (
              <DropdownMenuItem
                onClick={() => {
                  // A top-level navigation, so the session cookie travels as a
                  // first-party cookie for the server's own origin - this is the one
                  // call site where a plain prefix is enough and no fetch wrapper applies.
                  const url = `${API_BASE_URL}/api/files?path=${encodeURIComponent(file.path)}&download=true`
                  window.open(url, '_blank')
                }}
              >
                <Download className="w-4 h-4 mr-2" />
                {t('repo.fileBrowser.actions.download')}
              </DropdownMenuItem>
            )}
            <DropdownMenuItem onClick={() => startRename(file)}>
              <Edit3 className="w-4 h-4 mr-2" />
              {t('repo.fileBrowser.actions.rename')}
            </DropdownMenuItem>
            {onCopy && (
              <DropdownMenuItem onClick={() => startCopy(file)}>
                <Copy className="w-4 h-4 mr-2" />
                {t('repo.fileBrowser.actions.copy')}
              </DropdownMenuItem>
            )}
            {onDelete && (
              <DropdownMenuItem onClick={() => setDeleteTarget(file.path)} className="text-red-600">
                <Trash2 className="w-4 h-4 mr-2" />
                {t('repo.fileBrowser.actions.delete')}
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      )

      if (isEditing) {
        return (
          <div
            className="flex items-center gap-1 px-2 py-1 hover:bg-muted rounded group"
            style={{ paddingLeft: `${row.level * 16 + 8}px` }}
          >
            {row.expandable && <div className="w-4 shrink-0" />}
            <Input
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              onBlur={submitRename}
              onKeyDown={(e) => {
                if (e.key === 'Enter') submitRename()
                if (e.key === 'Escape') setEditingPath(null)
              }}
              className="h-7"
              autoFocus
            />
          </div>
        )
      }

      if (isCopying) {
        return (
          <div
            className="flex items-center gap-1 px-2 py-1 hover:bg-muted rounded group"
            style={{ paddingLeft: `${row.level * 16 + 8}px` }}
          >
            {row.expandable && <div className="w-4 shrink-0" />}
            <Input
              value={copyName}
              onChange={(e) => setCopyName(e.target.value)}
              onBlur={submitCopy}
              onKeyDown={(e) => {
                if (e.key === 'Enter') submitCopy()
                if (e.key === 'Escape') setCopyingPath(null)
              }}
              className="h-7"
              placeholder={t('repo.fileBrowser.actions.copyName')}
              autoFocus
            />
          </div>
        )
      }

      return (
        <div
          className={cn(
            'flex items-center gap-1 px-2 py-1.5 hover:bg-muted rounded cursor-pointer group',
            selectedFile?.path === file.path && 'bg-muted',
          )}
          style={{ paddingLeft: `${row.level * 16 + 8}px` }}
          onClick={() => {
            if (file.isDirectory) toggle(file.path)
            else onFileSelect?.(file)
          }}
          data-tree-row={file.path}
        >
          {row.expandable ? (
            <Button
              variant="ghost"
              size="sm"
              className="w-4 h-4 p-0 shrink-0"
              aria-label={expandedLabel(expandedOf(expandedPaths, file.path))}
              onClick={(e) => {
                e.stopPropagation()
                toggle(file.path)
              }}
              data-tree-toggle={file.path}
            >
              {expandedOf(expandedPaths, file.path) ? (
                <ChevronDown className="w-3 h-3" />
              ) : (
                <ChevronRight className="w-3 h-3" />
              )}
            </Button>
          ) : (
            <div className="w-4 shrink-0" />
          )}

          {file.isDirectory ? (
            expandedOf(expandedPaths, file.path) ? (
              <FolderOpen className="w-4 h-4 shrink-0" />
            ) : (
              <Folder className="w-4 h-4 shrink-0" />
            )
          ) : (
            <span className="w-4 h-4 flex items-center justify-center text-xs shrink-0">
              {FILE_ICON_MAP[file.name.split('.').pop()?.toLowerCase() ?? ''] ?? <File className="w-4 h-4" />}
            </span>
          )}

          <span className="flex-1 truncate text-sm">{file.name}</span>

          {menu}
        </div>
      )
    },
    [
      copyingPath,
      copyName,
      editingPath,
      editName,
      expandedPaths,
      isMobile,
      onCopy,
      onDelete,
      onFileSelect,
      selectedFile?.path,
      startCopy,
      startRename,
      submitCopy,
      submitRename,
      t,
      toggle,
    ],
  )

  const goUpRow = showGoUp ? (
    <div
      className="flex items-center gap-1 px-2 py-1.5 hover:bg-muted rounded cursor-pointer"
      onClick={handleGoUp}
      data-tree-row="__up__"
    >
      <span className="w-4 h-4 flex items-center justify-center text-sm">↩️</span>
      <span className="text-sm text-muted-foreground">..</span>
    </div>
  ) : null

  const deleteDialog = deleteTarget ? (
    <DeleteDialog
      open
      onOpenChange={(open) => !open && setDeleteTarget(null)}
      onConfirm={() => {
        onDelete?.(deleteTarget)
        setDeleteTarget(null)
      }}
      onCancel={() => setDeleteTarget(null)}
      title={
        findNode(files, deleteTarget)?.isDirectory
          ? t('repo.fileBrowser.deleteFolderTitle')
          : t('repo.fileBrowser.deleteFileTitle')
      }
      description={
        findNode(files, deleteTarget)?.isDirectory
          ? t('repo.fileBrowser.deleteFolderDescription')
          : t('repo.fileBrowser.deleteFileDescription')
      }
      itemName={nameFromPath(deleteTarget)}
    />
  ) : null

  if (files.length === 0) {
    return (
      <>
        <div className="text-center text-muted-foreground py-8">{t('repo.fileBrowser.noFiles')}</div>
        {deleteDialog}
      </>
    )
  }

  if (!virtualEnabled) {
    return (
      <>
        {goUpRow}
        {rows.map(renderRow)}
        {deleteDialog}
      </>
    )
  }

  const virtualRows = virtualizer.getVirtualItems()

  return (
    <>
      <div
        style={{
          height: `${virtualizer.getTotalSize() + (goUpRow ? 34 : 0)}px`,
          position: 'relative',
          width: '100%',
        }}
      >
        {goUpRow && (
          <div style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: 34 }}>{goUpRow}</div>
        )}
        {virtualRows.map((virtualRow) => (
          <div
            key={virtualRow.key}
            data-index={virtualRow.index}
            ref={virtualizer.measureElement}
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: '100%',
              transform: `translateY(${virtualRow.start + (goUpRow ? 34 : 0)}px)`,
            }}
          >
            {renderRow(rows[virtualRow.index] as FlatRow)}
          </div>
        ))}
      </div>
      {deleteDialog}
    </>
  )
})

function expandedOf(expanded: Set<string>, path: string): boolean {
  return expanded.has(path)
}

function expandedLabel(isExpanded: boolean): string {
  return isExpanded ? 'collapse' : 'expand'
}

function nameFromPath(path: string): string {
  return path.split('/').pop() ?? path
}

function editNameFromPath(path: string): string {
  return nameFromPath(path)
}

function replaceName(path: string, name: string): string {
  return path.replace(/\/[^/]*$/, `/${name}`)
}

function findNode(files: FileInfo[], path: string): FileInfo | undefined {
  for (const file of files) {
    if (file.path === path) return file
    if (file.children) {
      const found = findNode(file.children, path)
      if (found) return found
    }
  }
  return undefined
}
