import * as React from "react"
import { cn } from "@/lib/utils"

interface FullscreenSheetProps {
  children: React.ReactNode
  className?: string
  style?: React.CSSProperties
}

interface FullscreenSheetHeaderProps {
  children: React.ReactNode
  className?: string
}

interface FullscreenSheetContentProps {
  children: React.ReactNode
  className?: string
}

const FullscreenSheet = React.forwardRef<HTMLDivElement, FullscreenSheetProps>(
  ({ children, className, style, ...props }, ref) => (
    <div
      ref={ref}
      className={cn("fixed inset-0 z-50 bg-background flex flex-col", className)}
      style={style}
      {...props}
    >
      {children}
    </div>
  )
)
FullscreenSheet.displayName = "FullscreenSheet"

const FullscreenSheetHeader = React.forwardRef<HTMLDivElement, FullscreenSheetHeaderProps>(
  ({ children, className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        "flex-shrink-0 border-b border-border bg-background backdrop-blur-sm pt-safe",
        className
      )}
      {...props}
    >
      {children}
    </div>
  )
)
FullscreenSheetHeader.displayName = "FullscreenSheetHeader"

/**
 * The bounded body of a sheet: it takes the height the header leaves over and
 * clips whatever does not fit.
 *
 * `flex flex-col` is load-bearing, not decoration. Without a flex container
 * here, the children size to their content and `flex-1`/`min-h-0` on them do
 * nothing - the file browser's list grew to its full 400 rows, this box's
 * `overflow-hidden` cut off everything past the fold, and on a phone there was
 * no way to reach any of it. Bounding the children requires being their flex
 * parent.
 */
const FullscreenSheetContent = React.forwardRef<HTMLDivElement, FullscreenSheetContentProps>(
  ({ children, className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn("flex-1 overflow-hidden min-h-0 flex flex-col", className)}
      {...props}
    >
      {children}
    </div>
  )
)
FullscreenSheetContent.displayName = "FullscreenSheetContent"

export { FullscreenSheet, FullscreenSheetHeader, FullscreenSheetContent }
