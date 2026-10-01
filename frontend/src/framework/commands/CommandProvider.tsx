import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useLayer } from '@/framework/layer/useLayer'
import { CommandList, CommandRegistry } from './commandRegistry'
import { COMMAND_PALETTE_LAYER, type AppCommand } from './types'

export function CommandProvider({ children }: { children: ReactNode }) {
  const [commands, setCommands] = useState<ReadonlyMap<string, AppCommand>>(new Map())
  const [, setLayer] = useLayer(COMMAND_PALETTE_LAYER)

  const register = useCallback((command: AppCommand) => {
    setCommands((current) => {
      const next = new Map(current)
      next.set(command.id, command)
      return next
    })
    return () => {
      setCommands((current) => {
        if (!current.has(command.id)) return current
        const next = new Map(current)
        next.delete(command.id)
        return next
      })
    }
  }, [])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== 'k') return
      if (!event.metaKey && !event.ctrlKey) return
      event.preventDefault()
      setLayer(true)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [setLayer])

  const registry = useMemo(() => ({ register }), [register])

  return (
    <CommandRegistry.Provider value={registry}>
      <CommandList.Provider value={commands}>{children}</CommandList.Provider>
    </CommandRegistry.Provider>
  )
}
