import { createContext, useContext, useEffect, useMemo } from 'react'
import type { AppCommand } from './types'

export interface CommandRegistryValue {
  register: (command: AppCommand) => () => void
}

export const CommandRegistry = createContext<CommandRegistryValue | null>(null)
export const CommandList = createContext<ReadonlyMap<string, AppCommand>>(new Map())

export function useCommandRegistry(): CommandRegistryValue {
  const registry = useContext(CommandRegistry)
  if (!registry) throw new Error('useCommandRegistry must be used within a CommandProvider')
  return registry
}

export function useCommandList(): readonly AppCommand[] {
  const commands = useContext(CommandList)
  return useMemo(() => [...commands.values()], [commands])
}

export function useRegisterCommands(commands: readonly AppCommand[]): void {
  const { register } = useCommandRegistry()

  useEffect(() => {
    const unregisters = commands.map((command) => register(command))
    return () => unregisters.forEach((unregister) => unregister())
  }, [register, commands])
}
