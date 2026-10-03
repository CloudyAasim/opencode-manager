import { lazy, Suspense } from 'react'
import { TerminalSquare } from 'lucide-react'
import { useRegisterInspectorTab } from '@/framework/inspector/registry'
import type { InspectorTabDefinition } from '@/framework/inspector/registry'

// Loaded when the tab is opened, not when the app boots.
const TerminalView = lazy(() =>
  import('@/features/terminal/TerminalView').then((m) => ({ default: m.TerminalView })),
)

const TAB: InspectorTabDefinition = {
  id: 'terminal',
  labelKey: 'navigation.terminal',
  icon: TerminalSquare,
  render: () => (
    <Suspense fallback={null}>
      <TerminalView className="h-full" />
    </Suspense>
  ),
}

export function TerminalInspectorTab() {
  useRegisterInspectorTab(TAB)
  return null
}
