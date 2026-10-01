import type { ReactNode } from 'react'
import { InspectorRegistry, InspectorTabList, useInspectorTabStore } from './registry'

export function InspectorProvider({ children }: { children: ReactNode }) {
  const { tabs, register } = useInspectorTabStore()

  return (
    <InspectorRegistry.Provider value={{ register }}>
      <InspectorTabList.Provider value={tabs}>{children}</InspectorTabList.Provider>
    </InspectorRegistry.Provider>
  )
}
