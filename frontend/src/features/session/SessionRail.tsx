import { type ReactNode } from 'react'
import { usePersistentNumberState } from '@/hooks/usePersistentNumberState'
import { pixelDelta, useDragResize } from '@/framework/shell/useDragResize'
import { useDesktop } from '@/hooks/useDesktop'
import { useI18n } from '@/lib/i18n'
import { STORAGE_KEYS } from '@/lib/storage-keys'
import {
  SESSION_RAIL_WIDTH_DEFAULT,
  SESSION_RAIL_WIDTH_MAX,
  SESSION_RAIL_WIDTH_MIN,
} from '@/lib/repo-constants'

interface SessionRailProps {
  open: boolean
  onClose: () => void
  children: ReactNode
}

export function SessionRail({ open, onClose, children }: SessionRailProps) {
  const { t } = useI18n()
  const isDesktop = useDesktop()
  const [width, setWidth] = usePersistentNumberState({
    storageKey: STORAGE_KEYS.sessionRailWidth,
    defaultValue: SESSION_RAIL_WIDTH_DEFAULT,
    min: SESSION_RAIL_WIDTH_MIN,
    max: SESSION_RAIL_WIDTH_MAX,
  })

  const startResize = useDragResize({
    getValue: () => width,
    setValue: setWidth,
    toValue: pixelDelta,
  })

  if (!open) return null

  return (
    <>
      {!isDesktop && (
        <button
          type="button"
          aria-label={t('navigation.close')}
          onClick={onClose}
          className="absolute inset-0 z-30 bg-black/40 transition-opacity duration-200 md:hidden"
        />
      )}
      <aside
        className="absolute inset-y-0 left-0 z-40 flex w-[82%] max-w-xs shrink-0 flex-col overflow-hidden border-r border-border bg-card shadow-xl transition-transform duration-200 ease-out md:static md:z-auto md:w-auto md:max-w-none md:bg-card/75 md:shadow-none md:backdrop-blur-xl"
        style={isDesktop ? { width } : undefined}
      >
        <div className="min-h-0 flex-1 overflow-hidden">{children}</div>
      </aside>
      {isDesktop && (
        <div
          role="separator"
          aria-orientation="vertical"
          onMouseDown={startResize.onMouseDown}
          onTouchStart={startResize.onTouchStart}
          className="hidden md:block w-1 shrink-0 cursor-col-resize bg-border/40 transition-colors hover:bg-primary/40"
        />
      )}
    </>
  )
}
