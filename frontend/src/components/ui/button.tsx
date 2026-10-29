import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"
import { FOCUS_RING } from "@/components/ui/focus-ring"

const buttonVariants = cva(
  `inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg text-sm font-medium transition-colors cursor-pointer disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 shrink-0 [&_svg]:shrink-0 outline-none ${FOCUS_RING} aria-invalid:ring-destructive/20 aria-invalid:border-destructive`,
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground shadow-xs hover:bg-primary-hover",
        destructive:
          "bg-destructive text-destructive-foreground shadow-xs hover:bg-destructive/90 focus-visible:ring-destructive/30",
        // The affirmative one, and the destructive one with an outline. They
        // used to be written at the call sites, one button at a time - and
        // every one of them was a slightly different shade of the same idea.
        //
        // There is no green button: green is what a *mark* and a *message*
        // are, not what a button is. The one that used to be green is the
        // ordinary one now.
        "outline-destructive":
          "border-destructive bg-destructive/10 text-destructive hover:bg-destructive/20",
        outline:
          "border border-border bg-card hover:bg-accent hover:text-accent-foreground",
        // A quiet chip with a hairline border - the ones in a toolbar and in
        // the model picker. It used to be written at the call sites, one chip
        // at a time, and each of them named its own shade of the same idea.
        muted: "border border-border bg-muted/50 hover:bg-muted",
        // Floating on top of glass: the close key over a sheet.
        glass:
          "border border-border bg-background/90 backdrop-blur-sm hover:text-foreground",
        // Outlined in the accent colour: the key that jumps to the latest.
        accent:
          "border border-primary/40 bg-muted text-primary ring-1 ring-primary shadow-md backdrop-blur-md",
        // The key that stops a run, floating above the input.
        stop: "bg-destructive text-destructive-foreground border border-destructive shadow-md shadow-destructive ring-1 ring-destructive hover:bg-destructive/90",
        // A keycap: what a shortcut looks like.
        keycap: "bg-primary/20 border border-primary/50 text-foreground hover:border-primary",
        // A flat key that turns destructive when the pointer is on it - the
        // ones that clear, dismiss or delete.
        "ghost-destructive": "hover:bg-destructive/10 hover:text-destructive",
        // A small block you can pick - a filter, a version, a model, an answer.
        chip: "w-full justify-start rounded-lg border border-border bg-card text-start text-foreground transition-colors hover:border-primary/40 hover:bg-accent/40",
        // The one that is picked.
        "chip-selected": "w-full justify-start rounded-lg border border-primary bg-primary/10 text-start text-foreground transition-colors",
        // A toggle that is on. It used to be written at the call site as
        // `bg-primary text-primary-foreground`, on top of the outline face -
        // and the outline's own hover won, so the button greyed out under the
        // pointer.
        selected: "bg-primary text-primary-foreground hover:bg-primary-hover",
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-secondary/70",
        ghost:
          "hover:bg-accent hover:text-accent-foreground",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        // The ladder the app actually walks: 24, 28, 32, 36, 40 - and 44 on a
        // phone, where a finger has to find it.
        //
        // It used to start at 32, so the call sites that wanted something
        // smaller or bigger wrote their own height next to the size they
        // passed, and the two disagreed: `size="sm"` says 32 while the class
        // next to it says 24, and the class wins. The shared part's own size
        // was a thing nobody ever saw.
        "2xs": "h-6 rounded-md gap-1 px-2.5 has-[>svg]:px-2",
        xs: "h-7 rounded-md gap-1.5 px-3 has-[>svg]:px-2.5",
        sm: "h-8 rounded-md gap-1.5 px-3 has-[>svg]:px-2.5",
        default: "h-9 px-4 py-2 has-[>svg]:px-3",
        lg: "h-10 rounded-lg px-6 has-[>svg]:px-4",
        // A row in a dialog is roomier on a wide screen, and the row grows
        // with it. This used to be written at the call site, eleven times.
        wide: "h-9 px-4 py-2 has-[>svg]:px-3 sm:h-10",
        // The other way round: a row of touch-sized controls settles back to
        // the ordinary height once the screen is wide enough for a mouse.
        compact: "h-10 rounded-lg px-6 has-[>svg]:px-4 md:h-8",
        // A finger has to find this one, so it is taller on a phone and
        // settles back to the ordinary height on a desktop.
        touch: "h-11 rounded-lg px-5 has-[>svg]:px-4 md:h-9 md:px-4",
        "icon-2xs": "size-6",
        "icon-xs": "size-7",
        "icon-sm": "size-8",
        icon: "size-9",
        "icon-lg": "size-10",
        // A round one. The radius belongs to the size, the way it does for
        // every other step of the ladder - a round key is a shape of the same
        // kind as a small one.
        "icon-circle": "size-9 rounded-full",
        "icon-circle-sm": "size-7 rounded-full",
        // A finger has to find this one too: bigger on a phone, back to the
        // ordinary size on a desktop.
        "icon-touch": "size-10 md:size-8",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }) {
  const Comp = asChild ? Slot : "button"

  return (
    <Comp
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
