import { useCallback, useEffect, useState, memo } from 'react'
import { ChevronDown, ChevronRight, File, Folder, FolderOpen, RefreshCw } from 'lucide-react'
import { getFileApiUrl } from '@/api/files'
import type { FileInfo } from '@/types/files'
import { cn } from '@/lib/utils'
import { useI18n } from '@/lib/i18n'

function sortEntries(a: FileInfo, b: FileInfo) {
  if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1
  return a.name.localeCompare(b.name)
}

async function fetchChildren(path: string): Promise<FileInfo[]> {
  const response = await fetch(getFileApiUrl(path))
  if (!response.ok) throw new Error(String(response.status))
  const data = (await response.json()) as FileInfo
  return (data.children ?? []).slice().sort(sortEntries)
}

interface TreeNodeProps {
  file: FileInfo
  guides: boolean[]
  isLast: boolean
  selectedPath?: string
  onSelectFile: (file: FileInfo) => void
}

function TreeNode({ file, guides, isLast, selectedPath, onSelectFile }: TreeNodeProps) {
  const [expanded, setExpanded] = useState(false)
  const [children, setChildren] = useState<FileInfo[] | null>(null)
  const [loading, setLoading] = useState(false)

  const prefix = `${guides.map((draw) => (draw ? '│  ' : '   ')).join('')}${isLast ? '└─' : '├─'}`

  const toggle = async () => {
    if (!file.isDirectory) {
      onSelectFile(file)
      return
    }
    const next = !expanded
    setExpanded(next)
    if (next && children === null) {
      setLoading(true)
      try {
        setChildren(await fetchChildren(file.path))
      } catch {
        setChildren([])
      } finally {
        setLoading(false)
      }
    }
  }

  const isSelected = selectedPath === file.path

  return (
    <div>
      <button
        type="button"
        onClick={() => void toggle()}
        className={cn(
          'flex w-full items-center gap-1 rounded px-1 py-1 text-left transition-colors hover:bg-accent',
          isSelected && 'bg-primary-soft text-primary',
        )}
        title={file.path}
      >
        <span className="whitespace-pre font-mono text-xs text-muted-foreground select-none">{prefix}</span>
        {file.isDirectory ? (
          <span className="flex h-4 w-4 shrink-0 items-center justify-center text-muted-foreground">
            {expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
          </span>
        ) : (
          <span className="h-4 w-4 shrink-0" />
        )}
        {file.isDirectory ? (
          expanded ? <FolderOpen className="h-4 w-4 shrink-0 text-primary" /> : <Folder className="h-4 w-4 shrink-0 text-muted-foreground" />
        ) : (
          <File className="h-4 w-4 shrink-0 text-muted-foreground" />
        )}
        <span className="truncate">{file.name}</span>
      </button>

      {file.isDirectory && expanded && (
        <div>
          {children?.map((child, index) => (
            <TreeNode
              key={child.path}
              file={child}
              guides={[...guides, !isLast]}
              isLast={index === children.length - 1}
              selectedPath={selectedPath}
              onSelectFile={onSelectFile}
            />
          ))}
          {loading && (
            <div className="py-1 font-mono text-xs text-muted-foreground" style={{ paddingLeft: `${(guides.length + 1) * 1.5}rem` }}>
              {'│  '.repeat(guides.length + 1)}…
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export interface FileTreeExplorerProps {
  rootPath?: string
  onSelectFile: (file: FileInfo) => void
  selectedPath?: string
  className?: string
}

export const FileTreeExplorer = memo(function FileTreeExplorer({
  rootPath = '',
  onSelectFile,
  selectedPath,
  className,
}: FileTreeExplorerProps) {
  const { t } = useI18n()
  const [children, setChildren] = useState<FileInfo[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setChildren(await fetchChildren(rootPath))
    } catch {
      setError(t('repo.fileBrowser.errors.loadFilesGeneric'))
    } finally {
      setLoading(false)
    }
  }, [rootPath, t])

  useEffect(() => {
    void load()
  }, [load])

  return (
    <div className={cn('flex h-full min-h-0 flex-col', className)}>
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-2 py-1.5">
        <span className="truncate font-mono text-xs text-muted-foreground">{rootPath ? `/${rootPath}` : '/'}</span>
        <button
          type="button"
          onClick={() => void load()}
          className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
          aria-label={t('repo.fileBrowser.refresh')}
        >
          <RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto py-1">
        {error ? (
          <div className="px-3 py-6 text-center text-sm text-destructive">{error}</div>
        ) : loading && children === null ? (
          <div className="flex items-center justify-center py-8 text-muted-foreground">
            <RefreshCw className="h-5 w-5 animate-spin" />
          </div>
        ) : children && children.length > 0 ? (
          children.map((child, index) => (
            <TreeNode
              key={child.path}
              file={child}
              guides={[]}
              isLast={index === children.length - 1}
              selectedPath={selectedPath}
              onSelectFile={onSelectFile}
            />
          ))
        ) : (
          <div className="px-3 py-6 text-center text-sm text-muted-foreground">{t('repo.fileBrowser.noFiles')}</div>
        )}
      </div>
    </div>
  )
})
