import { useEffect, useRef } from 'react'
import { useLocation, useNavigationType } from 'react-router-dom'
import { useNavigationStore } from '@/stores/navigationStore'

const ANIMATION_DURATION = 300

export function useNavigationDirection() {
  const location = useLocation()
  const navType = useNavigationType()
  const setDirection = useNavigationStore((s) => s.setDirection)
  const setPhase = useNavigationStore((s) => s.setPhase)
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined)
  const isFirstRender = useRef(true)

  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false
      return
    }

    if (timerRef.current) {
      clearTimeout(timerRef.current)
    }

    const direction = navType === 'PUSH' ? 'push' : navType === 'POP' ? 'pop' : 'none'
    setDirection(direction)

    if (direction !== 'none') {
      setPhase('entering')
      timerRef.current = setTimeout(() => {
        setPhase('idle')
        setDirection('none')
      }, ANIMATION_DURATION)
    }

    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current)
      }
    }
  }, [location.pathname, navType, setDirection, setPhase])
}
