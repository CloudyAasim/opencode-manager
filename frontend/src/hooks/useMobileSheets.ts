import { useCallback, useMemo } from 'react'
import { useUrlParams } from './useUrlParams'

/**
 * 'more' is the top bar's hamburger: global navigation.
 * 'project' is the `⋮` on a session page: what you can do to this project.
 *
 * They are separate keys rather than one key with a remembered "where did this
 * come from", because the drawer is deep-linkable through `?mobileTab=`. A
 * shared key meant a hand-typed or stale URL opened whichever list was correct
 * for the path, which is the bug this split removes.
 *
 * The keys are validated on read. An unrecognised value opens nothing, so a
 * stale `?mobileTab=` cannot resurrect a drawer nothing points at.
 */
type MobileSheetKey = 'more' | 'project'

const SHEET_KEYS: readonly MobileSheetKey[] = ['more', 'project']

interface UseMobileSheetsReturn {
  openSheet: MobileSheetKey | null
  open: (key: MobileSheetKey) => void
  close: () => void
}

export function useMobileSheets(): UseMobileSheetsReturn {
  const { searchParams, updateParams } = useUrlParams()

  const openSheet = useMemo<MobileSheetKey | null>(() => {
    const v = searchParams.get('mobileTab')
    return SHEET_KEYS.find((key) => key === v) ?? null
  }, [searchParams])

  const open = useCallback((key: MobileSheetKey) => {
    updateParams((p) => p.set('mobileTab', key), 'push')
  }, [updateParams])

  const close = useCallback(() => {
    updateParams((p) => p.delete('mobileTab'), 'replace')
  }, [updateParams])

  return { openSheet, open, close }
}
