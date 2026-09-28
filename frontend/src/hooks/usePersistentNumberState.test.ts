import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { usePersistentNumberState } from './usePersistentNumberState'

describe('usePersistentNumberState', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  afterEach(() => {
    window.localStorage.clear()
  })

  it('returns the default value when nothing is persisted', () => {
    const { result } = renderHook(() =>
      usePersistentNumberState({ storageKey: 'test.a', defaultValue: 100, min: 0, max: 200 }),
    )
    expect(result.current[0]).toBe(100)
  })

  it('hydrates from localStorage on mount', () => {
    window.localStorage.setItem('test.a', '150')
    const { result } = renderHook(() =>
      usePersistentNumberState({ storageKey: 'test.a', defaultValue: 100, min: 0, max: 200 }),
    )
    expect(result.current[0]).toBe(150)
  })

  it('clamps a stored value that is out of range', () => {
    window.localStorage.setItem('test.a', '999')
    const { result } = renderHook(() =>
      usePersistentNumberState({ storageKey: 'test.a', defaultValue: 100, min: 0, max: 200 }),
    )
    expect(result.current[0]).toBe(200)
  })

  it('falls back to default when stored value is non-numeric', () => {
    window.localStorage.setItem('test.a', 'abc')
    const { result } = renderHook(() =>
      usePersistentNumberState({ storageKey: 'test.a', defaultValue: 100, min: 0, max: 200 }),
    )
    expect(result.current[0]).toBe(100)
  })

  it('persists updates to localStorage', () => {
    const { result } = renderHook(() =>
      usePersistentNumberState({ storageKey: 'test.a', defaultValue: 100, min: 0, max: 200 }),
    )
    act(() => {
      result.current[1](150)
    })
    expect(window.localStorage.getItem('test.a')).toBe('150')
    expect(result.current[0]).toBe(150)
  })

  it('clamps updates within min/max', () => {
    const { result } = renderHook(() =>
      usePersistentNumberState({ storageKey: 'test.a', defaultValue: 100, min: 0, max: 200 }),
    )
    act(() => {
      result.current[1](999)
    })
    expect(result.current[0]).toBe(200)
    act(() => {
      result.current[1](-5)
    })
    expect(result.current[0]).toBe(0)
  })

  it('supports functional updates', () => {
    const { result } = renderHook(() =>
      usePersistentNumberState({ storageKey: 'test.a', defaultValue: 100, min: 0, max: 200 }),
    )
    act(() => {
      result.current[1]((prev) => prev + 25)
    })
    expect(result.current[0]).toBe(125)
    expect(window.localStorage.getItem('test.a')).toBe('125')
  })
})