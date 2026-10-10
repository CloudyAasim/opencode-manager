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
  //
  // Two drawers, one per key. Both are mounted rather than switched, because
  // SideDrawer animates in and out and remounting on every key change threw
  // that away; only one is ever open.
  const isNarrow = useMediaQuery(MEDIA.belowSpacious)
  const { openSheet, close } = useMobileSheets()

  if (!isNarrow) return null

  return (
    <Suspense fallback={null}>
      <MoreDrawer isOpen={openSheet === 'more'} onClose={close} scope="global" />
      <MoreDrawer isOpen={openSheet === 'project'} onClose={close} scope="project" />
    </Suspense>
  )
}
