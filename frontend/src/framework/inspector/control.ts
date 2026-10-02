import { createContext, useContext } from 'react'
import type { InspectorTabDefinition } from './registry'

export interface InspectorControlValue {
  isOpen: boolean
  activeTab: string
  tabs: readonly InspectorTabDefinition[]
  open: (tab?: string) => void
  close: () => void
  toggle: () => void
  selectTab: (id: string) => void
}

export const InspectorControl = createContext<InspectorControlValue | null>(null)

export function useInspectorControl(): InspectorControlValue {
  const control = useContext(InspectorControl)
  if (!control) {
    throw new Error('useInspectorControl must be used within an InspectorProvider')
  }
  return control
}
