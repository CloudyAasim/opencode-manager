import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

/**
 * A text field.
 *
 * The height is a size of its own, and it is the same ladder the button walks:
 * `xs` is 28, `sm` is 32, `default` is 36, `lg` is 40. A row that has a field
 * and a button in it wants them to be the same height, and the only way to
 * guarantee that is for one name to mean one height everywhere.
 */
const inputVariants = cva(
  "flex w-full rounded-lg border border-input bg-card px-3 py-2 field-text text-foreground shadow-xs file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-ring/25 disabled:cursor-not-allowed disabled:opacity-50",
  {
    variants: {
      size: {
        xs: "h-7 rounded-md",
        sm: "h-8",
        default: "h-9",
        lg: "h-10",
      },
    },
    defaultVariants: {
      size: "default",
    },
  }
)

const Input = React.forwardRef<
  HTMLInputElement,
  // The native `size` attribute means "how many characters wide" - nothing in
  // this app uses it, and here the name means the height instead.
  Omit<React.ComponentProps<"input">, "size"> & VariantProps<typeof inputVariants>
>(({ className, type, size, ...props }, ref) => {
  return (
    <input
      type={type}
      className={cn(inputVariants({ size }), className)}
      ref={ref}
      {...props}
    />
  )
})
Input.displayName = "Input"

export { Input }
