import { SettingsDialog } from '@/features/settings/SettingsDialog'

export function Settings() {
  return (
    <div className="h-dvh max-h-dvh overflow-hidden bg-background flex flex-col pb-safe sm:pb-0">
      <SettingsDialog variant="page" />
    </div>
  )
}
