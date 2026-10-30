import { describe, it, expect, vi, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useCancellableTimer } from './use-cancellable-timer'

describe('useCancellableTimer', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('runs the task after the wait', () => {
    vi.useFakeTimers()
    const { result } = renderHook(() => useCancellableTimer())
    const task = vi.fn()

    act(() => {
      result.current.schedule(task, 500)
    })
    expect(task, 'the task ran before the wait was over').not.toHaveBeenCalled()

    act(() => {
      vi.advanceTimersByTime(500)
    })
    expect(task).toHaveBeenCalledTimes(1)
  })

  it('a wait that is replaced does not run', () => {
    vi.useFakeTimers()
    const { result } = renderHook(() => useCancellableTimer())
    const first = vi.fn()
    const second = vi.fn()

    act(() => {
      result.current.schedule(first, 500)
    })
    act(() => {
      result.current.schedule(second, 500)
    })
    act(() => {
      vi.advanceTimersByTime(500)
    })

    expect(first, 'the wait that was replaced still ran').not.toHaveBeenCalled()
    expect(second).toHaveBeenCalledTimes(1)
  })

  it('the wait does not outlive the part', () => {
    vi.useFakeTimers()
    const { result, unmount } = renderHook(() => useCancellableTimer())
    const task = vi.fn()

    act(() => {
      result.current.schedule(task, 500)
    })
    unmount()
    act(() => {
      vi.advanceTimersByTime(500)
    })

    expect(task, 'the wait ran after the part that owned it was gone').not.toHaveBeenCalled()
    expect(vi.getTimerCount(), 'the timer outlived the part').toBe(0)
  })

  it('cancel gives up on the wait', () => {
    vi.useFakeTimers()
    const { result } = renderHook(() => useCancellableTimer())
    const task = vi.fn()

    act(() => {
      result.current.schedule(task, 500)
    })
    act(() => {
      result.current.cancel()
    })
    act(() => {
      vi.advanceTimersByTime(500)
    })

    expect(task).not.toHaveBeenCalled()
  })
})
