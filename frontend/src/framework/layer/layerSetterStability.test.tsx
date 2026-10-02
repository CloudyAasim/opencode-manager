import { describe, it, expect } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useCallback, useRef } from 'react'
import type { ReactNode } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { LayerProvider } from './LayerProvider'
import { useLayer } from './useLayer'

/**
 * eslint reports three "missing dependency" warnings in SessionDetail for
 * setters that come from useLayer rather than from useState, so the rule
 * cannot know whether they are stable. They are not: LayerProvider memoises
 * its value on [layers, top], so every open or close hands out fresh
 * identities and the warnings are literally true.
 *
 * They are harmless, and the reason is worth pinning rather than assuming:
 * open and close dispatch `setLayers(current => ...)`, so a setter captured
 * on an earlier render still reads fresh state. That is an argument. This
 * is the fact.
 *
 * The setter is also now stable, which is what let the three warnings be
 * closed by adding the dependency instead of suppressing it.
 */
const wrapper = ({ children }: { children: ReactNode }) => (
  <MemoryRouter>
    <LayerProvider>{children}</LayerProvider>
  </MemoryRouter>
)

describe('a layer setter captured before the stack changed', () => {
  it('still opens its layer afterwards', () => {
    const { result } = renderHook(
      () => {
        const [open, setOpen] = useLayer('mcp')
        const [, setOther] = useLayer('sessions')
        // captured once and never refreshed - the shape a useCallback with an
        // empty dependency array produces
        const captured = useRef(setOpen)
        if (!captured.current) captured.current = setOpen
        const stale = useCallback(() => captured.current(true), [])
        return { open, setOther, stale }
      },
      { wrapper },
    )

    expect(result.current.open).toBe(false)

    // change the stack by opening a different layer, so the provider hands
    // out fresh identities and the captured setter really is the old one
    act(() => {
      result.current.setOther(true)
    })

    // the same function object, invoked after that change
    const same = result.current.stale
    act(() => {
      result.current.stale()
    })
    expect(same).toBe(result.current.stale)
    expect(result.current.open).toBe(true)
  })

  it('and the setOpen it returns keeps its identity when the stack changes', () => {
    // The contract, and the reason the three eslint warnings could be closed by
    // adding the dependency rather than suppressing it. Before this, the setter
    // was rebuilt on every open and close.
    const { result } = renderHook(
      () => ({ setA: useLayer('mcp')[1], setB: useLayer('skills')[1] }),
      { wrapper },
    )
    const before = result.current.setA
    act(() => {
      result.current.setB(true)
    })
    expect(result.current.setA).toBe(before)
  })
})
