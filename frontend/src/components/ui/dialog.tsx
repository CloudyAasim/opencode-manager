import * as React from "react"
import * as DialogPrimitive from "@radix-ui/react-dialog"
import { cva, type VariantProps } from "class-variance-authority"
import { X } from "lucide-react"

import { cn } from "@/lib/utils"
import { useSwipeBack } from '@/hooks/useMobile'
import { useVisualViewport } from '@/hooks/useVisualViewport'
import { useI18n } from '@/lib/i18n'
import { useMediaQuery } from '@/hooks/useMediaQuery'
import { MEDIA } from '@/framework/shell/breakpoints'

const BELOW_LAYOUT = MEDIA.belowLayout

const DialogOpenContext = React.createContext<boolean>(true)

function Dialog({ open, ...props }: React.ComponentProps<typeof DialogPrimitive.Root>) {
  return (
    <DialogOpenContext.Provider value={open ?? true}>
      <DialogPrimitive.Root open={open} {...props} />
    </DialogOpenContext.Provider>
  )
}

const DialogTrigger = DialogPrimitive.Trigger

const DialogPortal = DialogPrimitive.Portal

const DialogClose = DialogPrimitive.Close

const DialogOverlay = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    className={cn(
      "fixed inset-0 z-[70] bg-black/45 backdrop-blur-sm data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
      className
    )}
    {...props}
  />
))
DialogOverlay.displayName = DialogPrimitive.Overlay.displayName

interface DialogContentProps
  extends Omit<React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content>, 'onOpenChange'> {
  hideCloseButton?: boolean
  fullscreen?: boolean
  mobileFullscreen?: boolean
  mobileSwipeToClose?: boolean
  keyboardAware?: boolean
  canSwipeBack?: () => boolean
  onSwipeBack?: () => void
  variant?: VariantProps<typeof dialogContentVariants>['variant']
  /** 手机上永远是九成宽 ✓；再宽一点 ✗ 就说哪一档 ✓。 */
  width?: DialogContentWidth
  /** 宽屏上多高 ✗ 就说哪一档 ✓；不说 ✗ 就由内容决定 ✓。 */
  height?: DialogContentHeight
  onOpenChange?: (open: boolean) => void
  overlayClassName?: string
}

/**
 * 弹窗有多宽。
 *
 * 手机上是**九成宽** ✓；再宽一点 ✗，就有刻度了 ✓：
 * 窄 ✗、中 ✗、宽 ✓（默认的那一副 ✓）、更宽 ✗、很宽 ✗、最宽 ✗。
 *
 * 以前 ✗，**每个弹窗自己写** ✗——三十一处 ✗，其中四处是随手写的数 ✗
 * （420 ✗、440 ✗、500 ✗、560 ✗）✗，**不在任何刻度上** ✗。
 */
const DIALOG_CONTENT_WIDTHS = {
  sm: "sm:max-w-sm",
  md: "sm:max-w-md",
  lg: "sm:max-w-lg",
  xl: "sm:max-w-xl",
  "2xl": "sm:max-w-2xl",
  "3xl": "sm:max-w-3xl",
  "4xl": "sm:max-w-4xl",
  "6xl": "sm:max-w-6xl",
} as const

type DialogContentWidth = keyof typeof DIALOG_CONTENT_WIDTHS

/**
 * 弹窗在宽屏上有多高。
 *
 * 手机上 ✗ 它由内容决定 ✓（或者满屏 ✓）；到了宽屏上 ✗，**有两个数** ✗：
 * 八成 ✓ 和八五成 ✓——**十八处调用点自己写** ✗，十三处写的是同一句 ✗。
 */
const DIALOG_CONTENT_HEIGHTS = {
  short: "sm:max-h-[80vh]",
  tall: "sm:max-h-[85vh]",
} as const

type DialogContentHeight = keyof typeof DIALOG_CONTENT_HEIGHTS

/**
 * 弹窗有两副脸。
 *
 * 一副是**玻璃的** ✓（默认的那一副 ✓）——浮在应用上面 ✓，透出底下 ✓。
 * 另一副是**实心的卡片** ✓：三个弹窗自己写的 ✓，而它们没有名字 ✗。
 */
const dialogContentVariants = cva(
  "fixed z-[70] grid gap-4 border-0 sm:border bg-surface-glass backdrop-blur-lg shadow-lg duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
  {
    variants: {
      variant: {
        default: "",
        solid: "bg-card border-border",
        opaque: "bg-background border-border shadow-lg",
        plain: "bg-background",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

/**
 * 底行有两副：一副是**光光的** ✓，一副是**上面有一道线** ✓。
 *
 * 那道线**说了十四遍** ✓，而且有两种写法 ✗：八处只说"上面有线" ✓，
 * 六处还说清了线的颜色 ✓——于是那八处的线是**字的颜色** ✗。
 */
const dialogFooterVariants = cva(
  "flex flex-row sm:flex-row sm:justify-end gap-2",
  {
    variants: {
      variant: {
        default: "",
        divided: "border-t border-border",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

const DialogContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  DialogContentProps
>(({ className, children, hideCloseButton, fullscreen, mobileFullscreen, mobileSwipeToClose, keyboardAware, canSwipeBack, onSwipeBack, overlayClassName, style, variant, width = "lg", height, ...props }, ref) => {
  const { t } = useI18n()
  const isMobileFullscreenMode = fullscreen || mobileFullscreen
  const isDialogOpen = React.useContext(DialogOpenContext)
  const isMobile = useMediaQuery(BELOW_LAYOUT)
  const shouldEnableMobileSwipe = mobileSwipeToClose !== false && isMobile && isDialogOpen
  const shouldAnimateSwipe = shouldEnableMobileSwipe && isMobileFullscreenMode
  const { keyboardHeight } = useVisualViewport({ enabled: keyboardAware === true && isDialogOpen })
  const [swipeContainer, setSwipeContainer] = React.useState<HTMLDivElement | null>(null)
  const closeTriggerRef = React.useRef<HTMLButtonElement>(null)
  
  const combinedRef = React.useCallback((node: HTMLDivElement | null) => {
    setSwipeContainer(node)
    if (typeof ref === 'function') {
      ref(node)
    } else if (ref) {
      ref.current = node
    }
  }, [ref])
  
  const { bind: swipeBind, swipeStyles } = useSwipeBack(
    () => closeTriggerRef.current?.click(),
    { enabled: shouldEnableMobileSwipe, canBack: canSwipeBack, onBack: onSwipeBack }
  )
  
  React.useEffect(() => {
    if (shouldEnableMobileSwipe) {
      return swipeBind(swipeContainer)
    }
    return undefined
  }, [shouldEnableMobileSwipe, swipeBind, swipeContainer])
  
  // The notch is *added to* the dialog's margin, not instead of it.
  //
  // It used to be `paddingTop: env(safe-area-inset-top, 0px)` - the top
  // padding was replaced by the notch, so on a desktop (no notch) the dialog's
  // content sat flush against the top edge while its sides and bottom kept the
  // frame's margin. The margin is the frame's `--dialog-margin`: 16px on a
  // phone, 24px on a desktop.
  const baseStyle = isMobileFullscreenMode
    ? { paddingTop: 'calc(env(safe-area-inset-top, 0px) + var(--dialog-margin, 0px))' }
    : undefined

  const mergedStyle = {
    ...baseStyle,
    ...style,
    ...(shouldAnimateSwipe ? swipeStyles : undefined),
    ...(keyboardAware && keyboardHeight > 0 ? { paddingBottom: `${keyboardHeight}px` } : undefined),
  }

  return (
    <DialogPortal>
      {!fullscreen && <DialogOverlay className={overlayClassName} />}
      <DialogPrimitive.Content
        ref={combinedRef}
        autoFocus={false}
        aria-describedby={undefined}
        className={cn(
          dialogContentVariants({ variant }),
          DIALOG_CONTENT_WIDTHS[width],
          height ? DIALOG_CONTENT_HEIGHTS[height] : undefined,
          fullscreen
            ? "inset-0 w-full h-full max-w-none max-h-none p-0 rounded-none"
            : mobileFullscreen
              ? "inset-0 w-full h-full max-w-none max-h-none p-4 rounded-none [--dialog-margin:1rem] sm:[--dialog-margin:1.5rem] sm:inset-auto sm:left-[50%] sm:bottom-auto sm:w-[90%] sm:max-w-lg sm:translate-x-[-50%] sm:translate-y-0 sm:rounded-xl sm:top-[8%] sm:p-6"
              : "left-[50%] top-[50%] w-[90%] translate-x-[-50%] translate-y-[-50%] p-4 sm:p-6 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[state=closed]:slide-out-to-left-1/2 data-[state=closed]:slide-out-to-top-[48%] data-[state=open]:slide-in-from-left-1/2 data-[state=open]:slide-in-from-top-[48%] sm:rounded-xl",
          className
        )}
        style={Object.keys(mergedStyle).length > 0 ? mergedStyle : undefined}
        {...props}
      >
        {children}
        {shouldEnableMobileSwipe && (
          <DialogPrimitive.Close ref={closeTriggerRef} className="sr-only" data-swipe-close-trigger />
        )}
        {!hideCloseButton && !fullscreen && (
          <DialogPrimitive.Close 
            className="absolute right-4 top-4 sm:right-6 sm:top-6 rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none data-[state=open]:bg-accent data-[state=open]:text-muted-foreground"
            style={mobileFullscreen ? {
              top: 'calc(env(safe-area-inset-top, 0px) + var(--dialog-margin, 1rem))',
            } : undefined}
          >
            <X className="size-4" />
            <span className="sr-only">{t('ui.dialog.close')}</span>
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Content>
    </DialogPortal>
  )
})
DialogContent.displayName = DialogPrimitive.Content.displayName

const DialogHeader = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      // Left-aligned on every screen. It used to be `text-center sm:text-left`:
      // on a phone the title and the line under it were centred while on a
      // desktop they were not, so the same dialog was laid out two ways - and
      // the phone is the same design, not an older one.
      //
      // There is no `space-y` here either: the distance between the title and
      // the line under it belongs to the line under it (`DialogDescription`),
      // so that both ways of drawing a dialog's title bar - the plain header
      // and the `DialogTitleBar` - have the same distance.
      //
      // The rule under the title is here, and not in the call sites: a
      // dialog's title is separated from its body in every dialog, not only
      // in the ones that used `DialogTitleBar`. `border-border`, because a
      // rule with no colour of its own is drawn in the text colour - which
      // is the darkest thing on the screen.
      "flex flex-col text-left border-b border-border",
      className
    )}
    {...props}
  />
)
DialogHeader.displayName = "DialogHeader"

const DialogFooter = ({
  className,
  variant,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & VariantProps<typeof dialogFooterVariants>) => (
  <div
    className={cn(
      dialogFooterVariants({ variant }),
      className
    )}
    {...props}
  />
)
DialogFooter.displayName = "DialogFooter"

const DialogTitle = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    className={cn(
      "text-lg font-semibold leading-none tracking-tight",
      className
    )}
    {...props}
  />
))
DialogTitle.displayName = DialogPrimitive.Title.displayName

const DialogDescription = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description
    ref={ref}
    className={cn("mt-1.5 text-sm text-muted-foreground", className)}
    {...props}
  />
))
DialogDescription.displayName = DialogPrimitive.Description.displayName

export {
  Dialog,
  DialogPortal,
  DialogOverlay,
  DialogClose,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
}
