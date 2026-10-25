import * as React from "react"

import { cn } from "@/lib/utils"
import { FIELD_FACE } from "@/components/ui/field-face"
import { FOCUS_RING } from "@/components/ui/focus-ring"

type TextareaProps = React.TextareaHTMLAttributes<HTMLTextAreaElement>

const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, ...props }, ref) => {
    return (
      <textarea
        className={cn(
          `flex min-h-[80px] w-full ${FIELD_FACE} px-3 py-2 field-text placeholder:text-muted-foreground ${FOCUS_RING} focus-visible:border-primary disabled:cursor-not-allowed disabled:opacity-50`,
          className
        )}
        ref={ref}
        {...props}
      />
    )
  }
)
Textarea.displayName = "Textarea"

export { Textarea }