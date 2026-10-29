import * as React from "react"

import { cn } from "@/lib/utils"

/**
 * 点击外面就关的那层黑。
 *
 * 它**不是按钮** ✗ —— 它**盖住下面的东西** ✓，点它只是**关掉** ✓。
 * 可它**是一个键** ✓（键盘要能碰到它 ✓），所以它**是 `<button>`** ✓。
 *
 * 应用里有三处这样的一层黑 ✓（抽屉 ✓、会话栏 ✓、会话面板 ✓）✓，
 * 而**每一处自己写** ✗ —— 写出来**三种** ✗（有的能点 ✓、有的不能 ✓、
 * 有的糊了一层 ✓）✗。
 */
const Backdrop = React.forwardRef<
  HTMLButtonElement,
  React.ButtonHTMLAttributes<HTMLButtonElement>
>(({ className, ...props }, ref) => (
  <button
    ref={ref}
    type="button"
    data-slot="backdrop"
    className={cn(
      "absolute inset-0 z-30 bg-black/40 transition-opacity duration-200 md:hidden",
      className,
    )}
    {...props}
  />
))
Backdrop.displayName = "Backdrop"

export { Backdrop }
