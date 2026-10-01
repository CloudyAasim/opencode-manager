import { useCallback } from 'react'
import { useLayerStack } from './layerContext'

export function useLayer(name: string): [boolean, (open: boolean) => void] {
  const { isOpen, open, close } = useLayerStack()
  const setOpen = useCallback((next: boolean) => (next ? open(name) : close(name)), [open, close, name])
  return [isOpen(name), setOpen]
}
