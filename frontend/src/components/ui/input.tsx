import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"
import { FIELD_FACE } from "@/components/ui/field-face"
import { FOCUS_RING } from "@/components/ui/focus-ring"

/**
 * A text field.
 *
 * The height is a size of its own, and it is the same ladder the button walks:
 * `sm` is 32, `default` is 36, `lg` is 40. A row that has a field and a
 * button in it wants them to be the same height, and the only way to
 * guarantee that is for one name to mean one height everywhere.
 *
 * The smallest step is 32 and not 28: the app's smallest text is 16px on a
 * phone, and Breeze asks for 8px of air above and below it - 16 + 8 + 8 is
 * 32. A 28px field cannot hold the words in it.
 *
 * The face - the radius, the border, the background, the shadow - is not this
 * part's business: it is the field's, and it is written once (see
 * `field-face.ts`). The padding stays here, because how much room is left
 * inside is Breeze's own rule ("at least 8px"), not this part's.
 */
const inputVariants = cva(
  `flex w-full ${FIELD_FACE} px-3 py-2 field-text text-foreground file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground ${FOCUS_RING} focus-visible:border-primary disabled:cursor-not-allowed disabled:opacity-50`,
  {
    variants: {
      size: {
        sm: "h-8 rounded-md",
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
