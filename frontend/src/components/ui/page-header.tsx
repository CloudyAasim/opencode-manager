import * as React from "react";
import { cn } from "@/lib/utils";

export interface PageHeaderProps extends React.HTMLAttributes<HTMLElement> {
  children: React.ReactNode;
}

export const PageHeader = React.forwardRef<HTMLElement, PageHeaderProps>(
  ({ className, children, ...props }, ref) => {
    return (
      <header
        ref={ref}
        className={cn(
          // No `pt-safe` here, and it used to be here.
          //
          // The top safe-area inset is the hole for a notch or a punch hole, and
          // only the box that actually touches the top edge of the screen should
          // reserve it. This component is never that box: the shell's TopBar
          // renders above it on every authenticated screen, so a phone that
          // reports a 52px inset got 52px of blank band wedged between the two
          // headers - on the session page, the project list, the schedules, the
          // settings view and the not-found page alike. It looked like the chat
          // had been given a top margin.
          //
          // The inset belongs to `framework/shell/TopBar.tsx`, which is the
          // one that starts at y=0. There is a gate for this:
          // `test/architecture/safe-area-top.test.ts`.
          "sticky top-0 z-10 border-b border-border/60 bg-background/80 backdrop-blur-xl",
          className
        )}
        {...props}
      >
        {children}
      </header>
    );
  }
);

PageHeader.displayName = "PageHeader";
