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
      result.current.schedule('one', task, 500)
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
      result.current.schedule('one', first, 500)
    })
    act(() => {
      result.current.schedule('one', second, 500)
    })
    act(() => {
      vi.advanceTimersByTime(500)
    })

    expect(first, 'the wait that was replaced still ran').not.toHaveBeenCalled()
    expect(second).toHaveBeenCalledTimes(1)
  })

  it('two waits with different names do not disturb each other', () => {
    vi.useFakeTimers()
    const { result } = renderHook(() => useCancellableTimer())
    const copying = vi.fn()
    const moving = vi.fn()

    act(() => {
      result.current.schedule('copied', copying, 2000)
    })
    act(() => {
      result.current.schedule('next', moving, 4000)
    })
    act(() => {
      vi.advanceTimersByTime(2000)
    })

    expect(copying).toHaveBeenCalledTimes(1)
    expect(moving, 'the other wait was cancelled by this one').not.toHaveBeenCalled()

    act(() => {
      vi.advanceTimersByTime(2000)
    })
    expect(moving).toHaveBeenCalledTimes(1)
  })

  it('the wait does not outlive the part', () => {
    vi.useFakeTimers()
    const { result, unmount } = renderHook(() => useCancellableTimer())
    const task = vi.fn()

    act(() => {
      result.current.schedule('one', task, 500)
    })
    unmount()
    act(() => {
      vi.advanceTimersByTime(500)
    })

    expect(task, 'the wait ran after the part that owned it was gone').not.toHaveBeenCalled()
    expect(vi.getTimerCount(), 'the timer outlived the part').toBe(0)
  })

  it('cancel gives up on the wait under that name', () => {
    vi.useFakeTimers()
    const { result } = renderHook(() => useCancellableTimer())
    const task = vi.fn()

    act(() => {
      result.current.schedule('one', task, 500)
    })
    act(() => {
      result.current.cancel('one')
    })
    act(() => {
      vi.advanceTimersByTime(500)
    })

    expect(task).not.toHaveBeenCalled()
  })

  it('cancel leaves the other waits alone', () => {
    vi.useFakeTimers()
    const { result } = renderHook(() => useCancellableTimer())
    const first = vi.fn()
    const second = vi.fn()

    act(() => {
      result.current.schedule('one', first, 500)
      result.current.schedule('two', second, 500)
    })
    act(() => {
      result.current.cancel('one')
    })
    act(() => {
      vi.advanceTimersByTime(500)
    })

    expect(first).not.toHaveBeenCalled()
    expect(second, 'cancelling one wait cancelled the other').toHaveBeenCalledTimes(1)
  })
})
