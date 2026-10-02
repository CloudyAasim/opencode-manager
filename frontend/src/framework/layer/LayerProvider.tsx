import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useUrlParams } from '@/hooks/useUrlParams'
import { LayerContext, type LayerStack } from './layerContext'
import { isKnownLayer } from './knownLayers'

export function LayerProvider({ children }: { children: ReactNode }) {
  const { searchParams, updateParams } = useUrlParams()
  const rawDialog = searchParams.get('dialog')
  // A URL can name any layer it likes. One that nothing renders is not a
  // dialog, it is a phantom that would sit under every real one and keep
  // saying so in the address bar.
  const urlDialog = isKnownLayer(rawDialog) ? rawDialog : null

  const [layers, setLayers] = useState<string[]>(() => (urlDialog ? [urlDialog] : []))
  const syncedRef = useRef(urlDialog)

  // and it is not written back either
  const staleDialog = rawDialog !== null && urlDialog === null
  const top = layers.length > 0 ? layers[layers.length - 1]! : null

  useEffect(() => {
    if (staleDialog) {
      updateParams(
        (params) => {
          params.delete('dialog')
          return
        },
        'replace',
      )
    }
  }, [staleDialog, updateParams])

  useEffect(() => {
    if (urlDialog === syncedRef.current) return
    syncedRef.current = urlDialog
    setLayers((current) => {
      if (urlDialog === null) return current.length > 0 ? current.slice(0, -1) : current
      const at = current.indexOf(urlDialog)
      if (at !== -1) return current.slice(0, at + 1)
      return [...current, urlDialog]
    })
  }, [urlDialog])

  useEffect(() => {
    if (urlDialog === top) return
    syncedRef.current = top
    updateParams(
      (params) => {
        if (top === null) {
          params.delete('dialog')
          return
        }
        params.set('dialog', top)
        params.delete('mobileTab')
      },
      layers.length === 1 ? 'push' : 'replace',
    )
  }, [top, urlDialog, layers.length, updateParams])

  const value = useMemo<LayerStack>(
    () => ({
      layers,
      top,
      isOpen: (name) => layers.includes(name),
      open: (name) => setLayers((current) => (current.includes(name) ? current : [...current, name])),
      close: (name) => setLayers((current) => current.filter((entry) => entry !== name)),
      closeTop: () => setLayers((current) => current.slice(0, -1)),
    }),
    [layers, top],
  )

  return <LayerContext.Provider value={value}>{children}</LayerContext.Provider>
}
