export const COMMAND_PALETTE_LAYER = 'commandPalette'

export type BuiltinCommandGroup = 'navigate' | 'repo' | 'view'

export type CommandGroup = BuiltinCommandGroup | (string & {})

export interface AppCommand {
  id: string
  group: CommandGroup
  labelKey: string
  label?: string
  groupLabel?: string
  keywords?: readonly string[]
  run: () => void
}
