import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

/**
 * 一张卡片。
 *
 * 卡片本来只有一副脸 ✗——圆角 ✓、一道边 ✓、卡片那层底 ✓、一道很浅的影 ✓。
 * 而"别的样子" ✗——**嵌在面板里的** ✓（不要边 ✗、不要影 ✗）、
 * **空着的** ✓（虚线边 ✗）、**推后一步的** ✓（浅一点的底 ✗）、
 * **只是一个框** ✓（透的 ✗）——
 * 全都是调用点自己写的 ✗，而且**每一句都说了好几遍** ✗
 * （不要边不要影 ✗ 说了八遍 ✗，虚线边 ✗ 说了六遍 ✗）。
 *
 * 于是它们**有了名字** ✓：每一副写明自己的脸 ✓，调用点只说名字 ✓。
 */
const cardVariants = cva(
  "rounded-lg border border-border bg-card text-card-foreground shadow-xs",
  {
    variants: {
      variant: {
        default: "",
        // A card that sits inside a panel: it has no edge of its own.
        flat: "border-0 shadow-none",
        // An empty one - the dashed edge says something goes here.
        dashed: "border-dashed border-border/70",
        // A card that is pushed back.
        muted: "border-border/60 bg-background/60 shadow-none",
        // A card that is only a frame.
        transparent: "border-0 bg-transparent shadow-none",
        // One that is half there.
        faded: "border-border/70 bg-card/60",
        // The one that is picked, and the one that is open.
        selected: "border-primary shadow-lg shadow-primary bg-accent",
        active: "bg-accent border-border",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

const Card = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement> & VariantProps<typeof cardVariants>
>(({ className, variant, ...props }, ref) => (
  <div
    ref={ref}
    className={cn(cardVariants({ variant }), className)}
    {...props}
  />
))
Card.displayName = "Card"

const CardHeader = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn("flex flex-col space-y-1.5 p-6", className)}
    {...props}
  />
))
CardHeader.displayName = "CardHeader"

const CardTitle = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn(
      "text-base font-semibold leading-none tracking-tight",
      className
    )}
    {...props}
  />
))
CardTitle.displayName = "CardTitle"

const CardDescription = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn("text-sm text-muted-foreground", className)}
    {...props}
  />
))
CardDescription.displayName = "CardDescription"

const CardContent = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div ref={ref} className={cn("p-6 pt-0", className)} {...props} />
))
CardContent.displayName = "CardContent"

const CardFooter = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn("flex items-center p-6 pt-0", className)}
    {...props}
  />
))
CardFooter.displayName = "CardFooter"

export { Card, CardHeader, CardFooter, CardTitle, CardDescription, CardContent }
