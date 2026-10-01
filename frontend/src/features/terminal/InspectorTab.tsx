import { TerminalSquare } from 'lucide-react'
import { TerminalView } from '@/features/terminal/TerminalView'
import { useRegisterInspectorTab } from '@/framework/inspector/registry'
import type { InspectorTabDefinition } from '@/framework/inspector/registry'

const TAB: InspectorTabDefinition = {
  id: 'terminal',
  labelKey: 'navigation.terminal',
  icon: TerminalSquare,
  render: () => <TerminalView className="h-full" />,
}

export function TerminalInspectorTab() {
  useRegisterInspectorTab(TAB)
  return null
}
