import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useDesktop } from './useDesktop'
import { MEDIA, BREAKPOINT } from '@/framework/shell/breakpoints'

function stubViewport(width: number) {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query === MEDIA.layoutUp ? width >= BREAKPOINT.layout : false,
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    onchange: null,
    dispatchEvent: vi.fn(),
  }))
}

describe('useDesktop', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('returns true at or above the layout breakpoint', () => {
    stubViewport(1024)

    const { result } = renderHook(() => useDesktop())

    expect(result.current).toBe(true)
  })

  it('returns false below the layout breakpoint', () => {
    stubViewport(500)

    const { result } = renderHook(() => useDesktop())

    expect(result.current).toBe(false)
  })

  it('switches when the media query flips', () => {
    let matches = false
    const listeners: Array<() => void> = []
    vi.stubGlobal('matchMedia', (query: string) => ({
      get matches() {
        return query === MEDIA.layoutUp ? matches : false
      },
      media: query,
      addEventListener: (_: string, listener: () => void) => listeners.push(listener),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      onchange: null,
      dispatchEvent: vi.fn(),
    }))

    const { result } = renderHook(() => useDesktop())

    expect(result.current).toBe(false)

    act(() => {
      matches = true
      listeners.forEach((listener) => listener())
    })

    expect(result.current).toBe(true)
  })
})
