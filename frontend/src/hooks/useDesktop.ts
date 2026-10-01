import { useMediaQuery } from './useMediaQuery'
import { MEDIA } from '@/framework/shell/breakpoints'

export function useDesktop(): boolean {
  return useMediaQuery(MEDIA.layoutUp)
}
