import { useState, useEffect, useCallback, useRef, type CSSProperties } from 'react'
import { useNavigationStore } from '@/stores/navigationStore'

export function useMobile() {
  const [isMobile, setIsMobile] = useState(false)

  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth < 768)
    }

    checkMobile()
    window.addEventListener('resize', checkMobile)

    return () => window.removeEventListener('resize', checkMobile)
  }, [])

  return isMobile
}

const EDGE_WIDTH = 30
const VELOCITY_THRESHOLD = 0.3
const PROGRESS_THRESHOLD = 0.35
const ANIMATION_DURATION = 300

interface SwipeState {
  startX: number
  startY: number
  currentX: number
  startTime: number
  isSwiping: boolean
  isEdgeSwipe: boolean
  directionLocked: boolean
}

const initialSwipeState: SwipeState = {
  startX: 0,
  startY: 0,
  currentX: 0,
  startTime: 0,
  isSwiping: false,
  isEdgeSwipe: false,
  directionLocked: false,
}

export function useSwipeBack(): {
  bindSwipe: (el: HTMLElement | null) => (() => void) | undefined
  pageStyles: CSSProperties
  underlayStyles: CSSProperties
  isSwiping: boolean
} {
  const isMobile = useMobile()
  const swipeRef = useRef<SwipeState>({ ...initialSwipeState })
  const [progress, setProgress] = useState(0)
  const [animatingOut, setAnimatingOut] = useState(false)
  const swipeDisableCount = useNavigationStore((s) => s.swipeDisableCount)
  const setPhase = useNavigationStore((s) => s.setPhase)
  const setSwipeProgress = useNavigationStore((s) => s.setSwipeProgress)

  const enabled = isMobile && swipeDisableCount === 0

  const handleTouchStart = useCallback((e: TouchEvent) => {
    if (!enabled || animatingOut) return

    const touch = e.touches[0]
    const isEdge = touch.clientX <= EDGE_WIDTH

    swipeRef.current = {
      startX: touch.clientX,
      startY: touch.clientY,
      currentX: touch.clientX,
      startTime: Date.now(),
      isSwiping: false,
      isEdgeSwipe: isEdge,
      directionLocked: false,
    }
  }, [enabled, animatingOut])

  const handleTouchMove = useCallback((e: TouchEvent) => {
    if (!enabled) return

    const state = swipeRef.current
    if (!state.isEdgeSwipe) return

    const touch = e.touches[0]
    const deltaX = touch.clientX - state.startX
    const deltaY = Math.abs(touch.clientY - state.startY)

    if (!state.directionLocked) {
      if (Math.abs(deltaX) > 10 || deltaY > 10) {
        if (deltaX > 0 && deltaX > deltaY * 2) {
          state.directionLocked = true
          state.isSwiping = true
          setPhase('swiping')
        } else {
          state.isEdgeSwipe = false
          return
        }
      } else {
        return
      }
    }

    if (state.isSwiping) {
      e.preventDefault()
      state.currentX = touch.clientX
      const p = Math.max(0, Math.min(1, deltaX / window.innerWidth))
      setProgress(p)
      setSwipeProgress(p)
    }
  }, [enabled, setPhase, setSwipeProgress])

  const handleTouchEnd = useCallback(() => {
    if (!enabled) return

    const state = swipeRef.current

    if (state.isSwiping) {
      const deltaX = state.currentX - state.startX
      const elapsed = Date.now() - state.startTime
      const velocity = deltaX / elapsed
      const currentProgress = Math.max(0, Math.min(1, deltaX / window.innerWidth))

      if (velocity > VELOCITY_THRESHOLD || currentProgress > PROGRESS_THRESHOLD) {
        setAnimatingOut(true)
        setProgress(1)
        setSwipeProgress(1)
        setTimeout(() => {
          setAnimatingOut(false)
          setProgress(0)
          setSwipeProgress(0)
          setPhase('idle')
          window.history.back()
        }, ANIMATION_DURATION)
      } else {
        setAnimatingOut(true)
        setProgress(0)
        setSwipeProgress(0)
        setTimeout(() => {
          setAnimatingOut(false)
          setPhase('idle')
        }, ANIMATION_DURATION)
      }
    }

    swipeRef.current = { ...initialSwipeState }
  }, [enabled, setPhase, setSwipeProgress])

  const bindSwipe = useCallback((element: HTMLElement | null) => {
    if (!element || !enabled) return undefined

    element.addEventListener('touchstart', handleTouchStart, { passive: true })
    element.addEventListener('touchmove', handleTouchMove, { passive: false })
    element.addEventListener('touchend', handleTouchEnd, { passive: true })
    element.addEventListener('touchcancel', handleTouchEnd, { passive: true })

    return () => {
      element.removeEventListener('touchstart', handleTouchStart)
      element.removeEventListener('touchmove', handleTouchMove)
      element.removeEventListener('touchend', handleTouchEnd)
      element.removeEventListener('touchcancel', handleTouchEnd)
    }
  }, [enabled, handleTouchStart, handleTouchMove, handleTouchEnd])

  const isSwiping = progress > 0

  const pageStyles: CSSProperties = isSwiping || animatingOut
    ? {
        transform: `translateX(${progress * 100}%)`,
        transition: animatingOut ? `transform ${ANIMATION_DURATION}ms cubic-bezier(0.2, 0.9, 0.3, 1)` : undefined,
        willChange: 'transform',
        boxShadow: isSwiping ? '-8px 0 32px rgba(0, 0, 0, 0.15)' : undefined,
      }
    : {}

  const underlayStyles: CSSProperties = isSwiping || animatingOut
    ? {
        opacity: 0.4 * (1 - progress),
        transform: `translateX(${-70 * (1 - progress)}px)`,
        transition: animatingOut ? `all ${ANIMATION_DURATION}ms cubic-bezier(0.2, 0.9, 0.3, 1)` : undefined,
      }
    : { opacity: 0 }

  return { bindSwipe, pageStyles, underlayStyles, isSwiping }
}

export function useDisableSwipeBack(active = true) {
  const disableSwipe = useNavigationStore((s) => s.disableSwipe)
  const enableSwipe = useNavigationStore((s) => s.enableSwipe)

  useEffect(() => {
    if (!active) return
    disableSwipe()
    return () => enableSwipe()
  }, [active, disableSwipe, enableSwipe])
}

interface SwipeToCloseOptions {
  threshold?: number
  edgeWidth?: number
  enabled?: boolean
  canSwipeBack?: () => boolean
  onSwipeBack?: () => void
}

export function useSwipeToClose(
  onClose: () => void,
  options: SwipeToCloseOptions = {}
) {
  const {
    threshold = 80,
    edgeWidth = 30,
    enabled = true,
    canSwipeBack,
    onSwipeBack,
  } = options

  const isMobile = useMobile()
  const swipeRef = useRef<{ startX: number; startY: number; currentX: number; isSwiping: boolean; isEdgeSwipe: boolean }>({
    startX: 0, startY: 0, currentX: 0, isSwiping: false, isEdgeSwipe: false,
  })
  const [swipeProgress, setSwipeProgress] = useState(0)

  useDisableSwipeBack(enabled && isMobile)

  const handleTouchStart = useCallback((e: TouchEvent) => {
    if (!enabled || !isMobile) return
    const touch = e.touches[0]
    swipeRef.current = {
      startX: touch.clientX,
      startY: touch.clientY,
      currentX: touch.clientX,
      isSwiping: false,
      isEdgeSwipe: touch.clientX <= edgeWidth,
    }
  }, [enabled, isMobile, edgeWidth])

  const handleTouchMove = useCallback((e: TouchEvent) => {
    if (!enabled || !isMobile) return
    const state = swipeRef.current
    if (!state.isEdgeSwipe) return
    const touch = e.touches[0]
    const deltaX = touch.clientX - state.startX
    const deltaY = Math.abs(touch.clientY - state.startY)
    if (!state.isSwiping && deltaX > 10 && deltaX > deltaY * 2) {
      state.isSwiping = true
    }
    if (state.isSwiping) {
      e.preventDefault()
      state.currentX = touch.clientX
      setSwipeProgress(Math.min(Math.max(deltaX / threshold, 0), 1.5))
    }
  }, [enabled, isMobile, threshold])

  const handleTouchEnd = useCallback(() => {
    if (!enabled || !isMobile) return
    const state = swipeRef.current
    if (state.isSwiping && state.currentX - state.startX >= threshold) {
      if (canSwipeBack?.()) {
        onSwipeBack?.()
      } else {
        onClose()
      }
    }
    swipeRef.current = { startX: 0, startY: 0, currentX: 0, isSwiping: false, isEdgeSwipe: false }
    setSwipeProgress(0)
  }, [enabled, isMobile, threshold, onClose, canSwipeBack, onSwipeBack])

  const bind = useCallback((element: HTMLElement | null) => {
    if (!element || !enabled || !isMobile) return undefined
    element.addEventListener('touchstart', handleTouchStart, { passive: true })
    element.addEventListener('touchmove', handleTouchMove, { passive: false })
    element.addEventListener('touchend', handleTouchEnd, { passive: true })
    element.addEventListener('touchcancel', handleTouchEnd, { passive: true })
    return () => {
      element.removeEventListener('touchstart', handleTouchStart)
      element.removeEventListener('touchmove', handleTouchMove)
      element.removeEventListener('touchend', handleTouchEnd)
      element.removeEventListener('touchcancel', handleTouchEnd)
    }
  }, [enabled, isMobile, handleTouchStart, handleTouchMove, handleTouchEnd])

  const swipeStyles = {
    transform: swipeProgress > 0 ? `translateX(${swipeProgress * 50}px)` : undefined,
    transition: swipeProgress === 0 ? 'transform 0.2s ease-out' : undefined,
  }

  return { bind, swipeProgress, swipeStyles }
}
