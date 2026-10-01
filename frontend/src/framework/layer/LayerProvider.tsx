import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useUrlParams } from '@/hooks/useUrlParams'
import { LayerContext, type LayerStack } from './layerContext'

export function LayerProvider({ children }: { children: ReactNode }) {
  const { searchParams, updateParams } = useUrlParams()
  const urlDialog = searchParams.get('dialog')

  const [layers, setLayers] = useState<string[]>(() => (urlDialog ? [urlDialog] : []))
  const syncedRef = useRef(urlDialog)
  const top = layers.length > 0 ? layers[layers.length - 1]! : null

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
