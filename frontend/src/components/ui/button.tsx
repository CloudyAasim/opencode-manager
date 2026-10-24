import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg text-sm font-medium transition-colors cursor-pointer disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 shrink-0 [&_svg]:shrink-0 outline-none focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:ring-offset-2 focus-visible:ring-offset-background aria-invalid:ring-destructive/20 aria-invalid:border-destructive",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground shadow-xs hover:bg-primary-hover",
        destructive:
          "bg-destructive text-destructive-foreground shadow-xs hover:bg-destructive/90 focus-visible:ring-destructive/30",
        outline:
          "border border-border bg-card hover:bg-accent hover:text-accent-foreground",
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
        // A finger has to find this one, so it is taller on a phone and
        // settles back to the ordinary height on a desktop.
        touch: "h-11 rounded-lg px-5 has-[>svg]:px-4 md:h-9 md:px-4",
        "icon-2xs": "size-6",
        "icon-xs": "size-7",
        "icon-sm": "size-8",
        icon: "size-9",
        "icon-lg": "size-10",
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
