import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useDebouncedFormAutoSave, type AutoSaveStatus } from './useDebouncedFormAutoSave'

async function flush(ms: number) {
  await act(async () => {
    vi.advanceTimersByTime(ms)
    await Promise.resolve()
  })
}

describe('useDebouncedFormAutoSave', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('returns idle and does not save when not dirty', async () => {
    const onSave = vi.fn()
    const { result } = renderHook(() =>
      useDebouncedFormAutoSave({
        watchedValues: ['a'],
        getValues: () => ({ v: 'a' }),
        onSave,
        isDirty: false,
        isValid: true,
      }),
    )
    expect(result.current).toBe<AutoSaveStatus>('idle')
    await flush(2000)
    expect(onSave).not.toHaveBeenCalled()
  })

  it('returns idle and does not save when not valid', async () => {
    const onSave = vi.fn()
    const { result } = renderHook(() =>
      useDebouncedFormAutoSave({
        watchedValues: ['a'],
        getValues: () => ({ v: 'a' }),
        onSave,
        isDirty: true,
        isValid: false,
      }),
    )
    expect(result.current).toBe<AutoSaveStatus>('idle')
    await flush(2000)
    expect(onSave).not.toHaveBeenCalled()
  })

  it('saves after the configured delay when dirty and valid', async () => {
    const onSave = vi.fn()
    renderHook(() =>
      useDebouncedFormAutoSave({
        watchedValues: ['a'],
        getValues: () => ({ v: 'a' }),
        onSave,
        isDirty: true,
        isValid: true,
        delay: 800,
      }),
    )
    await flush(799)
    expect(onSave).not.toHaveBeenCalled()
    await flush(1)
    expect(onSave).toHaveBeenCalledWith({ v: 'a' })
  })

  it('debounces successive changes', async () => {
    const onSave = vi.fn()
    const { rerender } = renderHook(
      ({ v }: { v: string }) =>
        useDebouncedFormAutoSave({
          watchedValues: [v],
          getValues: () => ({ v }),
          onSave,
          isDirty: true,
          isValid: true,
        }),
      { initialProps: { v: 'a' } },
    )
    await act(async () => {
      rerender({ v: 'b' })
      rerender({ v: 'c' })
    })
    expect(onSave).not.toHaveBeenCalled()
    await flush(800)
    expect(onSave).toHaveBeenCalledTimes(1)
    expect(onSave).toHaveBeenCalledWith({ v: 'c' })
  })

  it('reports saving then saved for async onSave', async () => {
    let resolveSave: () => void = () => {}
    const onSave = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveSave = resolve
        }),
    )
    const { result } = renderHook(() =>
      useDebouncedFormAutoSave({
        watchedValues: ['a'],
        getValues: () => ({ v: 'a' }),
        onSave,
        isDirty: true,
        isValid: true,
        delay: 100,
        feedbackDuration: 200,
      }),
    )
    await act(async () => {
      vi.advanceTimersByTime(100)
      await Promise.resolve()
    })
    expect(result.current).toBe<AutoSaveStatus>('saving')
    await act(async () => {
      resolveSave()
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(result.current).toBe<AutoSaveStatus>('saved')
    await flush(200)
    expect(result.current).toBe<AutoSaveStatus>('idle')
  })

  it('reports error when onSave throws', async () => {
    const onSave = vi.fn(() => {
      throw new Error('boom')
    })
    const { result } = renderHook(() =>
      useDebouncedFormAutoSave({
        watchedValues: ['a'],
        getValues: () => ({ v: 'a' }),
        onSave,
        isDirty: true,
        isValid: true,
        delay: 50,
        feedbackDuration: 200,
      }),
    )
    await flush(50)
    expect(result.current).toBe<AutoSaveStatus>('error')
  })

  it('reports error when async onSave rejects', async () => {
    const onSave = vi.fn(() => Promise.reject(new Error('boom')))
    const { result } = renderHook(() =>
      useDebouncedFormAutoSave({
        watchedValues: ['a'],
        getValues: () => ({ v: 'a' }),
        onSave,
        isDirty: true,
        isValid: true,
        delay: 50,
        feedbackDuration: 200,
      }),
    )
    await act(async () => {
      vi.advanceTimersByTime(50)
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(result.current).toBe<AutoSaveStatus>('error')
  })

  it('skips saving when values have not changed since last save', async () => {
    const onSave = vi.fn()
    const { rerender } = renderHook(
      ({ v }: { v: string }) =>
        useDebouncedFormAutoSave({
          watchedValues: [v],
          getValues: () => ({ v }),
          onSave,
          isDirty: true,
          isValid: true,
          delay: 100,
          skipIfUnchanged: true,
        }),
      { initialProps: { v: 'a' } },
    )
    await flush(100)
    expect(onSave).toHaveBeenCalledTimes(1)
    await act(async () => {
      rerender({ v: 'a' })
    })
    await flush(100)
    expect(onSave).toHaveBeenCalledTimes(1)
    await act(async () => {
      rerender({ v: 'b' })
    })
    await flush(100)
    expect(onSave).toHaveBeenCalledTimes(2)
    expect(onSave).toHaveBeenLastCalledWith({ v: 'b' })
  })

  it('does not save when enabled is false', async () => {
    const onSave = vi.fn()
    renderHook(() =>
      useDebouncedFormAutoSave({
        watchedValues: ['a'],
        getValues: () => ({ v: 'a' }),
        onSave,
        isDirty: true,
        isValid: true,
        enabled: false,
      }),
    )
    await flush(2000)
    expect(onSave).not.toHaveBeenCalled()
  })
})
