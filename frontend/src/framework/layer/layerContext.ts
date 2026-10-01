import { createContext, useContext } from 'react'

export interface LayerStack {
  layers: readonly string[]
  top: string | null
  isOpen: (name: string) => boolean
  open: (name: string) => void
  close: (name: string) => void
  closeTop: () => void
}

export const LayerContext = createContext<LayerStack | null>(null)

export function useLayerStack(): LayerStack {
  const stack = useContext(LayerContext)
  if (!stack) throw new Error('useLayerStack must be used within a LayerProvider')
  return stack
}
