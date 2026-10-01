import { SettingsDialog } from '@/features/settings/SettingsDialog'

export function Settings() {
  return (
    <div className="h-dvh max-h-dvh overflow-hidden bg-background flex flex-col pb-[calc(env(safe-area-inset-bottom)+56px)] sm:pb-0">
      <SettingsDialog variant="page" />
    </div>
  )
}
