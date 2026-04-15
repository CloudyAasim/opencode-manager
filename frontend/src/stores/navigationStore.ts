import { create } from 'zustand'

type NavigationDirection = 'push' | 'pop' | 'none'
type NavigationPhase = 'idle' | 'entering' | 'swiping'

interface NavigationStore {
  direction: NavigationDirection
  phase: NavigationPhase
  swipeProgress: number
  swipeDisableCount: number
  setDirection: (d: NavigationDirection) => void
  setPhase: (p: NavigationPhase) => void
  setSwipeProgress: (p: number) => void
  disableSwipe: () => void
  enableSwipe: () => void
}

export const useNavigationStore = create<NavigationStore>((set) => ({
  direction: 'none',
  phase: 'idle',
  swipeProgress: 0,
  swipeDisableCount: 0,
  setDirection: (direction) => set({ direction }),
  setPhase: (phase) => set({ phase }),
  setSwipeProgress: (swipeProgress) => set({ swipeProgress }),
  disableSwipe: () => set((s) => ({ swipeDisableCount: s.swipeDisableCount + 1 })),
  enableSwipe: () => set((s) => ({ swipeDisableCount: Math.max(0, s.swipeDisableCount - 1) })),
}))
