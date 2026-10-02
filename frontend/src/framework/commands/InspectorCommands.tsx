import { useMemo } from 'react'
import { useInspectorControl } from '@/framework/inspector/control'
import { useRegisterCommands } from './commandRegistry'
import type { AppCommand } from './types'

export function InspectorCommands() {
  const { open, toggle, isOpen, tabs } = useInspectorControl()

  const commands = useMemo<AppCommand[]>(() => {
    const perTab: AppCommand[] = tabs.map((tab) => ({
      id: `view.inspector.${tab.id}`,
      group: 'view',
      labelKey: tab.labelKey,
      keywords: ['inspector', 'panel', tab.id],
      run: () => open(tab.id),
    }))
    return [
      {
        id: 'view.inspector',
        group: 'view',
        labelKey: isOpen ? 'shell.inspector.close' : 'shell.inspector.open',
        keywords: ['inspector', 'panel', 'sidebar'],
        run: toggle,
      },
      ...perTab,
    ]
  }, [open, toggle, isOpen, tabs])

  useRegisterCommands(commands)
  return null
}
