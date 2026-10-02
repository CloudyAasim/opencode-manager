import { useCallback, useRef } from 'react'
import { PanelRightClose, PanelRightOpen } from 'lucide-react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Button } from '@/components/ui/button'
import { useI18n } from '@/lib/i18n'
import { useMediaQuery } from '@/hooks/useMediaQuery'
import { usePersistentNumberState } from '@/hooks/usePersistentNumberState'
import { STORAGE_KEYS } from '@/lib/storage-keys'
import { MEDIA } from '@/framework/shell/breakpoints'
import { useInspectorControl } from '@/framework/inspector/control'

const MIN_WIDTH = 320
const MAX_WIDTH = 720
const DEFAULT_WIDTH = 420

export function Inspector() {
  const { t } = useI18n()
  const canSplit = useMediaQuery(MEDIA.expandedUp)
  const { isOpen, activeTab, tabs, close, toggle, selectTab } = useInspectorControl()
  const [width, setWidth] = usePersistentNumberState({
    storageKey: STORAGE_KEYS.inspectorWidth,
    defaultValue: DEFAULT_WIDTH,
    min: MIN_WIDTH,
    max: MAX_WIDTH,
  })
  const draggingRef = useRef(false)

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

  if (!isOpen) {
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
      <Tabs value={activeTab} onValueChange={selectTab} className="flex min-h-0 flex-1 flex-col">
        <div className="flex items-center gap-1 border-b border-border px-2 py-1">
          <TabsList className="h-8">
            {tabs.map((entry) => {
              const Icon = entry.icon
              return (
                <TabsTrigger key={entry.id} value={entry.id} className="gap-1.5 text-xs">
                  <Icon className="size-3.5" />
                  {t(entry.labelKey)}
                </TabsTrigger>
              )
            })}
          </TabsList>
          <Button
            variant="ghost"
            size="icon"
            onClick={close}
            aria-label={t('shell.inspector.close')}
            title={t('shell.inspector.close')}
          >
            <PanelRightClose className="size-4" />
          </Button>
        </div>

        {tabs.map((entry) => (
          <TabsContent
            key={entry.id}
            value={entry.id}
            className="min-h-0 flex-1 overflow-hidden data-[state=inactive]:hidden"
          >
            {entry.render()}
          </TabsContent>
        ))}
      </Tabs>
    </aside>
  )
}
