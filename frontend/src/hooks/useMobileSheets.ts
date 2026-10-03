import { useCallback, useMemo } from 'react'
import { useUrlParams } from './useUrlParams'

/**
 * Only 'more' has ever had an entry point. The other three keys were still
 * declared here and still rendered by MobileSheetHost, so a hand-typed
 * ?mobileTab=repos could open a drawer no button in the app could reach.
 * They are deleted rather than kept "in case": the components behind them
 * have no producer, and git keeps them if they ever come back.
 */
type MobileSheetKey = 'more'

interface UseMobileSheetsReturn {
  openSheet: MobileSheetKey | null
  open: (key: MobileSheetKey) => void
  close: () => void
}

export function useMobileSheets(): UseMobileSheetsReturn {
  const { searchParams, updateParams } = useUrlParams()

  const openSheet = useMemo<MobileSheetKey | null>(() => {
    const v = searchParams.get('mobileTab')
    return v === 'more' ? v : null
  }, [searchParams])

  const open = useCallback((key: MobileSheetKey) => {
    updateParams((p) => p.set('mobileTab', key), 'push')
  }, [updateParams])

  const close = useCallback(() => {
    updateParams((p) => p.delete('mobileTab'), 'replace')
  }, [updateParams])

  return { openSheet, open, close }
}
