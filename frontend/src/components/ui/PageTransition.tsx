import { useRef, useEffect, useState, type ReactNode } from 'react'
import { useLocation } from 'react-router-dom'
import { useNavigationStore } from '@/stores/navigationStore'
import { useSwipeBack, useMobile } from '@/hooks/useMobile'

interface PageTransitionProps {
  children: ReactNode
}

export function PageTransition({ children }: PageTransitionProps) {
  const isMobile = useMobile()
  const location = useLocation()
  const pageRef = useRef<HTMLDivElement>(null)
  const direction = useNavigationStore((s) => s.direction)
  const phase = useNavigationStore((s) => s.phase)
  const { bindSwipe, pageStyles, underlayStyles, isSwiping } = useSwipeBack()

  useEffect(() => {
    return bindSwipe(pageRef.current)
  }, [bindSwipe])

  const isAnimating = isMobile && phase === 'entering' && direction !== 'none'
  const isActive = isSwiping || isAnimating

  const animationClass = isAnimating
    ? direction === 'push'
      ? 'page-slide-in-push'
      : 'page-slide-in-pop'
    : ''

  const [reducedMotion, setReducedMotion] = useState(false)

  useEffect(() => {
    const mql = window.matchMedia('(prefers-reduced-motion: reduce)')
    setReducedMotion(mql.matches)
    const handler = (e: MediaQueryListEvent) => setReducedMotion(e.matches)
    mql.addEventListener('change', handler)
    return () => mql.removeEventListener('change', handler)
  }, [])

  return (
    <>
      {isMobile && isActive && !reducedMotion && (
        <div
          className="fixed inset-0 bg-black pointer-events-none"
          style={{
            zIndex: 40,
            ...underlayStyles,
          }}
        />
      )}
      <div
        key={location.pathname}
        ref={pageRef}
        className={reducedMotion ? '' : animationClass}
        style={{
          position: 'relative',
          zIndex: isActive ? 50 : undefined,
          minHeight: '100dvh',
          ...(isSwiping && !reducedMotion ? pageStyles : {}),
          willChange: isActive ? 'transform' : undefined,
        }}
      >
        {children}
      </div>
    </>
  )
}
