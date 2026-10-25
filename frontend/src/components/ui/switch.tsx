import * as React from "react"
import * as SwitchPrimitives from "@radix-ui/react-switch"

import { cn } from "@/lib/utils"
import { FOCUS_RING_STRONG } from "@/components/ui/focus-ring"

/**
 * Plasma's switch, not a green light.
 *
 * The geometry is exact on purpose: a 44x24 track with a 1px border and 1px
 * padding leaves a 40x20 content box, and the 20px knob fills it to the
 * pixel - off at 2..22, on at 22..42. A knob that does not land on the
 * border is a knob the eye reads as misaligned.
 *
 * The colours are the scheme's: the track is Plasma Blue when it is on and
 * a muted neutral when it is off, with a Paper White knob on top. The old
 * version was `bg-green-600` with a gray track, which is a traffic light
 * wearing a KDE's colours.
 */
const Switch = React.forwardRef<
  React.ElementRef<typeof SwitchPrimitives.Root>,
  React.ComponentPropsWithoutRef<typeof SwitchPrimitives.Root>
>(({ className, ...props }, ref) => (
  <SwitchPrimitives.Root
      data-slot="switch"
      className={cn(
        `peer inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border border-border p-px transition-colors ${FOCUS_RING_STRONG}`,
        "disabled:cursor-not-allowed disabled:opacity-50",
        "data-[state=checked]:border-primary data-[state=checked]:bg-primary",
        "data-[state=unchecked]:bg-muted",
        className
      )}
      {...props}
      ref={ref}
  >
    <SwitchPrimitives.Thumb
      data-slot="switch-thumb"
      className={cn(
        "pointer-events-none block size-5 rounded-full bg-switch-thumb shadow-sm ring-0 transition-transform",
        "data-[state=checked]:translate-x-5 data-[state=unchecked]:translate-x-0"
      )}
    />
  </SwitchPrimitives.Root>
))
Switch.displayName = SwitchPrimitives.Root.displayName

export { Switch }
