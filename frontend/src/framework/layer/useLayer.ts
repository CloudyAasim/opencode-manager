import { useCallback, useRef } from 'react'
import { useLayerStack } from './layerContext'
import { KNOWN_LAYERS } from './knownLayers'

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
  // LayerProvider only accepts names on KNOWN_LAYERS, because it seeds its
  // stack from ?dialog= and used to believe whatever that said. The cost of
  // that is that a name nobody registered simply never opens, silently - so
  // it gets said out loud here, in development, rather than found in CI.
  if (import.meta.env.DEV && !KNOWN_LAYERS.has(name)) {
    throw new Error(
      `useLayer('${name}') is not in KNOWN_LAYERS, so LayerProvider will ` +
        `discard it and this layer will never open. Add it to ` +
        `framework/layer/knownLayers.ts.`,
    )
  }

  const { isOpen, open, close } = useLayerStack()
  const latest = useRef({ open, close, name })
  latest.current = { open, close, name }
  const setOpen = useCallback((next: boolean) => {
    const current = latest.current
    return next ? current.open(current.name) : current.close(current.name)
  }, [])
  return [isOpen(name), setOpen]
}
