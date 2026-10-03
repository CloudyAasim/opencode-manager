import { Suspense, lazy } from 'react'
import { useMobileSheets } from '@/hooks/useMobileSheets'
import { useMediaQuery } from '@/hooks/useMediaQuery'
import { MEDIA } from '@/framework/shell/breakpoints'

const MoreDrawer = lazy(() =>
  import('@/features/navigation/MoreDrawer').then((m) => ({ default: m.MoreDrawer })),
)

export function MobileSheetHost() {
  // The condition has to be the one the More button uses, not the one a
  // phone uses: the bar collapses to that button below `spacious`, so mounting
  // the drawer only below `layout` left a visible button that opened nothing.
  const isNarrow = useMediaQuery(MEDIA.belowSpacious)
  const { openSheet, close } = useMobileSheets()

  if (!isNarrow) return null

  return (
    <Suspense fallback={null}>
      <MoreDrawer isOpen={openSheet === 'more'} onClose={close} />
    </Suspense>
  )
}
