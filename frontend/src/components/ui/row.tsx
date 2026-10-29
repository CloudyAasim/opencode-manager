import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

/**
 * 清单里的一行。
 *
 * 它**不是按钮** ✗——按钮是**一个动作** ✓（挤在一处 ✓、有高矮 ✓）；
 * 一行是**清单里的一项** ✓：**占满整行** ✓、**文字靠左** ✓、
 * **选中时有一层底** ✓。
 *
 * 应用里到处是这种行 ✓（下拉 ✓、多选 ✓、文件树 ✓、命令列表 ✓、抽屉 ✓、
 * 顶栏 ✓、分支 ✓、提交 ✓、文件 ✓ …）✓，而**每一处自己画** ✗——
 * 画出来**十几种** ✗（选中的底 ✗ 有四种 ✗、悬停 ✗ 有三种 ✗、
 * 圆角 ✗、内边距 ✗、行高 ✗）✗。
 *
 * 于是**行只写一处** ✓：普通的 ✓ 与选中的 ✓ 两副 ✓，
 * 调用点**只说名字** ✓（`selected` ✓）✓，**不自己画** ✓。
 */
/**
 * 一行有多宽。
 *
 * 只有两个宽度被真正用过 ✓——**撑满** ✓ 与 **按自己的来** ✓（顶栏里那一排 ✓）✓。
 */
const ROW_WIDTHS = {
  full: "w-full",
  auto: "w-auto",
} as const

type RowWidth = keyof typeof ROW_WIDTHS

const rowVariants = cva(
  `flex items-center gap-2 rounded-md px-3 py-2 text-start text-sm text-foreground transition-colors hover:bg-muted`,
  {
    variants: {
      variant: {
        default: "",
        /** 自己带一道边的 ✓——工作区那一行 ✓。 */
        bordered: "border border-border bg-muted/30",
      },
      /** 选中的那一个 ✓——**底下有一层** ✓。 */
      selected: {
        false: "",
        true: "bg-accent text-accent-foreground hover:bg-accent",
      },
      /** 紧的 ✓——一行里有好几样东西 ✓。 */
      size: {
        default: "",
        sm: "px-2 py-1",
        // A finger is not a cursor. The drawer's entries are the phone's whole
        // navigation, so they have to be big enough to hit - 44px is the number
        // every platform agrees on.
        touch: "min-h-11 px-3",
      },
    },
    defaultVariants: {
      variant: "default",
      selected: false,
      size: "default",
    },
  }
)

const Row = React.forwardRef<
  HTMLButtonElement,
  React.ButtonHTMLAttributes<HTMLButtonElement> &
    VariantProps<typeof rowVariants> & {
      /** 一行有多宽 ✓——**说哪一档** ✓，不许自己写 ✓。 */
      width?: RowWidth
    }
>(({ className, variant, width = "full", selected, size, ...props }, ref) => (
  <button
    ref={ref}
    data-slot="row"
    className={cn(rowVariants({ variant, selected, size }), ROW_WIDTHS[width], className)}
    {...props}
  />
))
Row.displayName = "Row"

export { Row, rowVariants }
