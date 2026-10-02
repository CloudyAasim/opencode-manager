import type { ReactNode } from 'react'

// A card with a title, and sometimes something sitting to the right of that
// title. Seven settings panels drew it by hand; the title's bottom margin had
// already split into mb-4 and mb-6, which is what copy-paste looks like from
// the outside.
interface SettingsPanelProps {
  title: string
  actions?: ReactNode
  children: ReactNode
}

export function SettingsPanel({ title, actions, children }: SettingsPanelProps) {
  return (
    <div className="bg-card border border-border rounded-lg p-6">
      {actions ? (
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-lg font-semibold text-foreground">{title}</h2>
          <div className="flex items-center gap-2 text-sm">{actions}</div>
        </div>
      ) : (
        <h2 className="text-lg font-semibold text-foreground mb-6">{title}</h2>
      )}
      {children}
    </div>
  )
}
