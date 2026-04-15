import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useSwipeToClose } from './useMobile'
import { useNavigationStore } from '@/stores/navigationStore'

describe('useSwipeToClose', () => {
  const mockOnClose = vi.fn()
  const mockOnSwipeBack = vi.fn()
  const mockCanSwipeBack = vi.fn()

  beforeEach(() => {
    mockOnClose.mockClear()
    mockOnSwipeBack.mockClear()
    mockCanSwipeBack.mockClear()
    Object.defineProperty(window, 'innerWidth', {
      writable: true,
      configurable: true,
      value: 375,
    })
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('calls onClose when swipe completes and canSwipeBack is false', () => {
    mockCanSwipeBack.mockReturnValue(false)
    
    const element = document.createElement('div')
    document.body.appendChild(element)
    
    const { result } = renderHook(() =>
      useSwipeToClose(mockOnClose, {
        enabled: true,
        canSwipeBack: mockCanSwipeBack,
        onSwipeBack: mockOnSwipeBack,
        threshold: 80,
      })
    )

    const cleanup = result.current.bind(element)
    
    const touchStart = new TouchEvent('touchstart', {
      touches: [{ clientX: 10, clientY: 100 }] as any,
    })
    const touchMove = new TouchEvent('touchmove', {
      touches: [{ clientX: 100, clientY: 100 }] as any,
    })
    const touchEnd = new TouchEvent('touchend', {
      changedTouches: [{ clientX: 100, clientY: 100 }] as any,
    })
    
    element.dispatchEvent(touchStart)
    element.dispatchEvent(touchMove)
    element.dispatchEvent(touchEnd)
    
    expect(mockCanSwipeBack).toHaveBeenCalled()
    expect(mockOnSwipeBack).not.toHaveBeenCalled()
    expect(mockOnClose).toHaveBeenCalled()
    
    if (cleanup) cleanup()
    document.body.removeChild(element)
  })

  it('calls onSwipeBack when swipe completes and canSwipeBack is true', () => {
    mockCanSwipeBack.mockReturnValue(true)

    const element = document.createElement('div')
    document.body.appendChild(element)
    
    const { result } = renderHook(() =>
      useSwipeToClose(mockOnClose, {
        enabled: true,
        canSwipeBack: mockCanSwipeBack,
        onSwipeBack: mockOnSwipeBack,
        threshold: 80,
      })
    )

    const cleanup = result.current.bind(element)
    
    const touchStart = new TouchEvent('touchstart', {
      touches: [{ clientX: 10, clientY: 100 }] as any,
    })
    const touchMove = new TouchEvent('touchmove', {
      touches: [{ clientX: 100, clientY: 100 }] as any,
    })
    const touchEnd = new TouchEvent('touchend', {
      changedTouches: [{ clientX: 100, clientY: 100 }] as any,
    })
    
    element.dispatchEvent(touchStart)
    element.dispatchEvent(touchMove)
    element.dispatchEvent(touchEnd)
    
    expect(mockCanSwipeBack).toHaveBeenCalled()
    expect(mockOnSwipeBack).toHaveBeenCalled()
    expect(mockOnClose).not.toHaveBeenCalled()
    
    if (cleanup) cleanup()
    document.body.removeChild(element)
  })

  it('falls back to onClose when canSwipeBack is not provided', () => {
    const { result } = renderHook(() =>
      useSwipeToClose(mockOnClose, {
        enabled: true,
        threshold: 80,
      })
    )

    expect(result.current.bind).toBeDefined()
    expect(mockOnClose).not.toHaveBeenCalled()
  })

  it('returns swipeStyles for visual feedback', () => {
    const { result } = renderHook(() =>
      useSwipeToClose(mockOnClose, {
        enabled: true,
      })
    )

    expect(result.current.swipeStyles).toBeDefined()
    expect(result.current.swipeStyles.transform).toBeUndefined()
    expect(result.current.swipeStyles.transition).toBe('transform 0.2s ease-out')
  })

  it('disables swipe when enabled is false', () => {
    const { result } = renderHook(() =>
      useSwipeToClose(mockOnClose, {
        enabled: false,
      })
    )

    expect(result.current.bind).toBeDefined()
  })

  it('binds touch event listeners to element', () => {
    const element = document.createElement('div')
    const addEventListenerSpy = vi.spyOn(element, 'addEventListener')
    const removeEventListenerSpy = vi.spyOn(element, 'removeEventListener')

    const { result } = renderHook(() =>
      useSwipeToClose(mockOnClose, {
        enabled: true,
        threshold: 80,
      })
    )

    const cleanup = result.current.bind(element)
    
    expect(addEventListenerSpy).toHaveBeenCalledWith('touchstart', expect.any(Function), { passive: true })
    expect(addEventListenerSpy).toHaveBeenCalledWith('touchmove', expect.any(Function), { passive: false })
    expect(addEventListenerSpy).toHaveBeenCalledWith('touchend', expect.any(Function), { passive: true })
    expect(addEventListenerSpy).toHaveBeenCalledWith('touchcancel', expect.any(Function), { passive: true })

    if (cleanup) {
      cleanup()
      expect(removeEventListenerSpy).toHaveBeenCalled()
    }
  })

  it('disables route-level swipe-back while active', () => {
    const { result } = renderHook(() =>
      useSwipeToClose(mockOnClose, {
        enabled: true,
      })
    )

    expect(result.current.bind).toBeDefined()
    expect(result.current.swipeStyles).toBeDefined()
  })

  it('increments and releases navigation store swipe-disable refcount', () => {
    const initialCount = useNavigationStore.getState().swipeDisableCount
    
    const { unmount } = renderHook(() =>
      useSwipeToClose(mockOnClose, {
        enabled: true,
      })
    )
    
    const afterMountCount = useNavigationStore.getState().swipeDisableCount
    expect(afterMountCount).toBeGreaterThan(initialCount)
    
    unmount()
    
    const afterUnmountCount = useNavigationStore.getState().swipeDisableCount
    expect(afterUnmountCount).toBe(initialCount)
  })
})
