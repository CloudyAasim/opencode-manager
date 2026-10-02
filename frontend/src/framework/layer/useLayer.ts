import { useCallback, useRef } from 'react'
import { useLayerStack } from './layerContext'

/**
 * The setter it hands back is stable, and that is a contract rather than an
 * accident. LayerProvider memoises its context value on [layers, top], so a
 * setter built from open/close would get a new identity on every open and
 * close - and every `useCallback` that closed over it would be a stale
 * closure that eslint rightly complains about.
 *
 * Reading the stack through a ref keeps the identity while still calling
 * the current open/close, which matters because both dispatch
 * `setLayers(current => ...)` and therefore need no state of their own.
 */
export function useLayer(name: string): [boolean, (open: boolean) => void] {
  const { isOpen, open, close } = useLayerStack()
  const latest = useRef({ open, close, name })
  latest.current = { open, close, name }
  const setOpen = useCallback((next: boolean) => {
    const current = latest.current
    return next ? current.open(current.name) : current.close(current.name)
  }, [])
  return [isOpen(name), setOpen]
}
