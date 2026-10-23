import type { ReactNode } from 'react'

// A card with a title, sometimes a line under it, and sometimes something
// sitting to the right of that title. Seven settings panels drew it by hand;
// the title's bottom margin had already split into mb-4 and mb-6, which is
// what copy-paste looks like from the outside.
//
// The Git settings panel drew a *different* card for the same thing - a strip
// with a rule under it, its own padding, its own title. Two kinds of card
// for one job. So the strip is gone: this is the card, and the line under the
// title is a prop.
//
// The actions line up with the *title*, not with the middle of the two lines.
// A button floating half a title down reads as belonging to the description.
interface SettingsPanelProps {
  title: string
  description?: string
  actions?: ReactNode
  children: ReactNode
}

export function SettingsPanel({ title, description, actions, children }: SettingsPanelProps) {
  return (
    <div className="bg-card border border-border rounded-lg p-6">
      {actions || description ? (
        <div className="flex items-start justify-between gap-2 mb-6">
          <div className="min-w-0">
            <h2 className="text-lg font-semibold text-foreground">{title}</h2>
            {description ? (
              <p className="mt-1 text-sm text-muted-foreground">{description}</p>
            ) : null}
          </div>
          {actions ? <div className="flex shrink-0 items-center gap-2 text-sm">{actions}</div> : null}
        </div>
      ) : (
        <h2 className="text-lg font-semibold text-foreground mb-6">{title}</h2>
      )}
      {children}
    </div>
  )
}
