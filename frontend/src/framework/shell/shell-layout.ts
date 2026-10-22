import { useMediaQuery } from '@/hooks/useMediaQuery'
import { MEDIA } from './breakpoints'

/**
 * Whether the shell floats.
 *
 * A wide screen has room for the chrome to lift off the edge of the window;
 * a phone does not, and the notch is right there. So the same answer has to
 * reach the top bar, the window and the status strip - and it is asked for
 * in one place, because three answers to the same question is how they stop
 * agreeing.
 */
export function useFloatingShell(): boolean {
  return useMediaQuery(MEDIA.spaciousUp)
}
