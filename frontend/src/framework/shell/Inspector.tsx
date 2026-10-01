import { useCallback, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { FileCode2, GitBranch, PanelRightClose, PanelRightOpen, TerminalSquare } from 'lucide-react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Button } from '@/components/ui/button'
import { FileBrowserView } from '@/components/file-browser/FileBrowserView'
import { TerminalView } from '@/components/terminal/TerminalView'
import { SourceControlContent } from '@/components/source-control/SourceControlContent'
import { listRepos } from '@/api/repos'
import { useI18n } from '@/lib/i18n'
import { useMediaQuery } from '@/hooks/useMediaQuery'
import { usePersistentBooleanState } from '@/hooks/usePersistentBooleanState'
import { usePersistentNumberState } from '@/hooks/usePersistentNumberState'
import { STORAGE_KEYS } from '@/lib/storage-keys'
import { MEDIA } from '@/framework/shell/breakpoints'

const MIN_WIDTH = 320
const MAX_WIDTH = 720
const DEFAULT_WIDTH = 420

function repoIdFromPath(pathname: string): number | null {
  const match = /^\/repos\/(\d+)/.exec(pathname)
  return match?.[1] ? Number(match[1]) : null
}

export function Inspector() {
  const { t } = useI18n()
  const canSplit = useMediaQuery(MEDIA.expandedUp)
  const { pathname } = useLocation()
  const { data: repos } = useQuery({ queryKey: ['repos'], queryFn: listRepos })
  const [open, setOpen, toggle] = usePersistentBooleanState({
    storageKey: STORAGE_KEYS.inspectorOpen,
    defaultValue: false,
  })
  const [width, setWidth] = usePersistentNumberState({
    storageKey: STORAGE_KEYS.inspectorWidth,
    defaultValue: DEFAULT_WIDTH,
    min: MIN_WIDTH,
    max: MAX_WIDTH,
  })
  const [tab, setTab] = useState('files')
  const draggingRef = useRef(false)

  const repoId = repoIdFromPath(pathname)
  const repo = repos?.find((entry) => entry.id === repoId)

  const onPointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    draggingRef.current = true
    event.currentTarget.setPointerCapture(event.pointerId)
  }, [])

  const onPointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!draggingRef.current) return
      const next = window.innerWidth - event.clientX
      setWidth(Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, next)))
    },
    [setWidth],
  )

  const onPointerUp = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    draggingRef.current = false
    event.currentTarget.releasePointerCapture(event.pointerId)
  }, [])

  if (!canSplit) return null

  if (!open) {
    return (
      <div className="flex shrink-0 items-start border-l border-border p-2">
        <Button
          variant="ghost"
          size="icon"
          onClick={toggle}
          aria-label={t('shell.inspector.open')}
          title={t('shell.inspector.open')}
        >
          <PanelRightOpen className="size-4" />
        </Button>
      </div>
    )
  }

  return (
    <aside className="flex shrink-0 flex-col border-l border-border bg-background" style={{ width }}>
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label={t('shell.inspector.resize')}
        className="absolute inset-y-0 -left-1 z-10 w-2 cursor-col-resize"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
      />
      <Tabs value={tab} onValueChange={setTab} className="flex min-h-0 flex-1 flex-col">
        <div className="flex items-center gap-1 border-b border-border px-2 py-1">
          <TabsList className="h-8">
            <TabsTrigger value="files" className="gap-1.5 text-xs">
              <FileCode2 className="size-3.5" />
              {t('navigation.files')}
            </TabsTrigger>
            <TabsTrigger value="source" className="gap-1.5 text-xs">
              <GitBranch className="size-3.5" />
              {t('misc.sourceControl.title')}
            </TabsTrigger>
            <TabsTrigger value="terminal" className="gap-1.5 text-xs">
              <TerminalSquare className="size-3.5" />
              {t('navigation.terminal')}
            </TabsTrigger>
          </TabsList>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setOpen(false)}
            aria-label={t('shell.inspector.close')}
            title={t('shell.inspector.close')}
          >
            <PanelRightClose className="size-4" />
          </Button>
        </div>

        <TabsContent value="files" className="min-h-0 flex-1 overflow-hidden data-[state=inactive]:hidden">
          <FileBrowserView embedded showPath={false} showHeader={false} />
        </TabsContent>

        <TabsContent value="source" className="min-h-0 flex-1 overflow-hidden data-[state=inactive]:hidden">
          {repoId && repo ? (
            <SourceControlContent
              repoId={repoId}
              currentBranch={repo.currentBranch || repo.branch || ''}
              isMobile={false}
            />
          ) : (
            <p className="p-4 text-sm text-muted-foreground">{t('shell.inspector.needProject')}</p>
          )}
        </TabsContent>

        <TabsContent
          value="terminal"
          className="min-h-0 flex-1 overflow-hidden data-[state=inactive]:hidden"
        >
          <TerminalView className="h-full" />
        </TabsContent>
      </Tabs>
    </aside>
  )
}
