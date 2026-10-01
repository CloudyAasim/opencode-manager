import { useCallback } from 'react'
import { useLayer } from '@/framework/layer/useLayer'

export function useDialogParam(name: string): [boolean, (open: boolean) => void] {
  const [isOpen, setLayer] = useLayer(name)
  const setOpen = useCallback((open: boolean) => setLayer(open), [setLayer])
  return [isOpen, setOpen]
}
