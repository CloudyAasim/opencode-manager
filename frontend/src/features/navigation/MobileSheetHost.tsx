import { Suspense, lazy } from 'react'
import { useMobileSheets } from '@/hooks/useMobileSheets'
import { useMobile } from '@/hooks/useMobile'

const MoreDrawer = lazy(() =>
  import('@/features/navigation/MoreDrawer').then((m) => ({ default: m.MoreDrawer })),
)

export function MobileSheetHost() {
  const isMobile = useMobile()
  const { openSheet, close } = useMobileSheets()

  if (!isMobile) return null

  return (
    <Suspense fallback={null}>
      <MoreDrawer isOpen={openSheet === 'more'} onClose={close} />
    </Suspense>
  )
}
