export const COMMAND_PALETTE_LAYER = 'commandPalette'

export type CommandGroup = 'navigate' | 'repo' | 'view'

export interface AppCommand {
  id: string
  group: CommandGroup
  labelKey: string
  label?: string
  keywords?: readonly string[]
  run: () => void
}
