import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { usePersistentJSONState } from './usePersistentJSONState'

describe('usePersistentJSONState', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('falls back to the default when nothing is stored', () => {
    const { result } = renderHook(() =>
      usePersistentJSONState<string[]>({ storageKey: 'test:json', defaultValue: ['a'] }),
    )
    expect(result.current[0]).toEqual(['a'])
  })

  it('hydrates from an existing value', () => {
    window.localStorage.setItem('test:json', JSON.stringify(['x', 'y']))
    const { result } = renderHook(() =>
      usePersistentJSONState<string[]>({ storageKey: 'test:json', defaultValue: ['a'] }),
    )
    expect(result.current[0]).toEqual(['x', 'y'])
  })

  it('persists updates as JSON', () => {
    const { result } = renderHook(() =>
      usePersistentJSONState<string[]>({ storageKey: 'test:json', defaultValue: ['a'] }),
    )
    act(() => result.current[1](['b', 'c']))
    expect(result.current[0]).toEqual(['b', 'c'])
    expect(window.localStorage.getItem('test:json')).toBe('["b","c"]')
  })

  it('supports functional updates', () => {
    const { result } = renderHook(() =>
      usePersistentJSONState<number[]>({ storageKey: 'test:json', defaultValue: [1] }),
    )
    act(() => result.current[1]((prev) => [...prev, 2]))
    expect(result.current[0]).toEqual([1, 2])
  })

  it('rejects a stored value that fails validation', () => {
    window.localStorage.setItem('test:json', JSON.stringify({ not: 'an array' }))
    const isArray = (value: unknown): value is number[] => Array.isArray(value)
    const { result } = renderHook(() =>
      usePersistentJSONState<number[]>({
        storageKey: 'test:json',
        defaultValue: [7],
        validate: isArray,
      }),
    )
    expect(result.current[0]).toEqual([7])
  })

  it('falls back when the stored value is not valid JSON', () => {
    window.localStorage.setItem('test:json', 'not json{')
    const { result } = renderHook(() =>
      usePersistentJSONState<string[]>({ storageKey: 'test:json', defaultValue: ['a'] }),
    )
    expect(result.current[0]).toEqual(['a'])
  })

  it('survives a localStorage write failure', () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota exceeded')
    })
    const { result } = renderHook(() =>
      usePersistentJSONState<string[]>({ storageKey: 'test:json', defaultValue: ['a'] }),
    )
    act(() => result.current[1](['z']))
    expect(result.current[0]).toEqual(['z'])
    setItem.mockRestore()
  })
})
