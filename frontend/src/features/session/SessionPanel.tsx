import { useCallback, useEffect, useState, type ComponentType, type ReactNode } from 'react'
import { Plus, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { usePersistentJSONState } from '@/hooks/usePersistentJSONState'
import { useI18n } from '@/lib/i18n'
import { cn } from '@/lib/utils'

export interface SessionPanelTab {
  id: string
  labelKey: string
  icon: ComponentType<{ className?: string }>
  render: () => ReactNode
}

interface SessionPanelProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  isDesktop: boolean
  width: number
  onResizeStart: (event: React.MouseEvent) => void
  onResizeTouchStart: (event: React.TouchEvent) => void
  onResizeKey: (event: React.KeyboardEvent) => void
  tabs: readonly SessionPanelTab[]
  defaultTabIds: readonly string[]
  storageKey: string
}

function isKnownTabs(value: unknown, known: ReadonlySet<string>): value is string[] {
  if (!Array.isArray(value)) return false
  if (value.length === 0) return false
  return value.every((id) => typeof id === 'string' && known.has(id))
}

export function SessionPanel({
  open,
  onOpenChange,
  isDesktop,
  width,
  onResizeStart,
  onResizeTouchStart,
  onResizeKey,
  tabs,
  defaultTabIds,
  storageKey,
}: SessionPanelProps) {
  const { t } = useI18n()

  // Four entries, and the caller usually builds the array fresh each render,
  // so memoising on it would only hide a bug behind a false sense of caching.
  const byId = new Map(tabs.map((tab) => [tab.id, tab]))
  const known = new Set(byId.keys())

  const [tabIds, setTabIds] = usePersistentJSONState<string[]>({
    storageKey,
    defaultValue: [...defaultTabIds],
    validate: (value) => isKnownTabs(value, known),
  })

  const [activeId, setActiveId] = useState<string>(defaultTabIds[0] ?? '')

  const visibleIds = tabIds.filter((id) => known.has(id))

  useEffect(() => {
    if (visibleIds.length === 0) return
    if (visibleIds.includes(activeId)) return
    setActiveId(visibleIds[0]!)
  }, [visibleIds, activeId])

  const removeTab = useCallback(
    (id: string) => {
      setTabIds((current) => (current.length > 1 ? current.filter((entry) => entry !== id) : current))
    },
    [setTabIds],
  )

  const addTab = useCallback(
    (id: string) => {
      setTabIds((current) => (current.includes(id) ? current : [...current, id]))
      setActiveId(id)
    },
    [setTabIds],
  )

  if (!open) return null

  const active = byId.get(visibleIds.includes(activeId) ? activeId : (visibleIds[0] ?? ''))
  const hidden = tabs.filter((tab) => !visibleIds.includes(tab.id))

  return (
    <>
      {isDesktop && (
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label={t('navigation.resizePanel')}
          tabIndex={0}
          onMouseDown={onResizeStart}
          onTouchStart={onResizeTouchStart}
          onKeyDown={onResizeKey}
          className="absolute inset-y-0 z-20 hidden w-2 cursor-col-resize bg-transparent transition-colors hover:bg-primary/40 focus-visible:bg-primary/40 md:block"
          style={{ right: width }}
        />
      )}
      {!isDesktop && (
        <button
          type="button"
          aria-label={t('navigation.close')}
          onClick={() => onOpenChange(false)}
          className="absolute inset-0 z-30 bg-black/40 transition-opacity duration-200 md:hidden"
        />
      )}
      <aside
        className="absolute inset-x-0 bottom-0 z-40 flex max-h-[78vh] shrink-0 flex-col overflow-hidden rounded-t-xl border-t border-border bg-card shadow-[0_-12px_32px_rgba(0,0,0,0.18)] transition-transform duration-200 ease-out md:inset-y-0 md:right-0 md:left-auto md:z-auto md:max-h-none md:w-auto md:rounded-none md:border-l md:border-t-0 md:bg-transparent md:shadow-none"
        style={isDesktop ? { width } : undefined}
      >
        <div className="flex shrink-0 items-center gap-1 overflow-x-auto border-b border-border px-2 py-1.5 scrollbar-thin">
          {visibleIds.map((id) => {
            const tab = byId.get(id)
            if (!tab) return null
            const Icon = tab.icon
            return (
              <div key={id} className="group flex shrink-0 items-center">
                <Button
                  variant={id === active?.id ? 'secondary' : 'ghost'}
                  size="sm"
                  className={cn('h-7 gap-1 px-2', visibleIds.length > 1 && 'rounded-r-none')}
                  onClick={() => setActiveId(id)}
                >
                  <Icon className="h-3.5 w-3.5" />
                  {t(tab.labelKey)}
                </Button>
                {visibleIds.length > 1 && (
                  <button
                    type="button"
                    onClick={() => removeTab(id)}
                    aria-label={t('navigation.remove')}
                    className="h-7 rounded-r-md px-1 text-muted-foreground opacity-0 transition-opacity hover:text-foreground group-hover:opacity-100"
                  >
                    <X className="h-3 w-3" />
                  </button>
                )}
              </div>
            )
          })}
          {hidden.length > 0 && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 shrink-0"
                  aria-label={t('navigation.add')}
                  title={t('navigation.add')}
                >
                  <Plus className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {hidden.map((tab) => {
                  const Icon = tab.icon
                  return (
                    <DropdownMenuItem key={tab.id} onClick={() => addTab(tab.id)}>
                      <span className="mr-2">
                        <Icon className="h-3.5 w-3.5" />
                      </span>
                      {t(tab.labelKey)}
                    </DropdownMenuItem>
                  )
                })}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
          <Button
            variant="ghost"
            size="icon"
            className="ml-auto h-7 w-7 shrink-0"
            onClick={() => onOpenChange(false)}
            aria-label={t('navigation.close')}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
        <div className="min-h-0 flex-1 overflow-hidden">{active?.render()}</div>
      </aside>
    </>
  )
}
