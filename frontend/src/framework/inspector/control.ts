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
  /** Move the tab at `from` to index `to`, keeping the rest in order. */
  moveTab: (from: number, to: number) => void
}

export const InspectorControl = createContext<InspectorControlValue | null>(null)

export function useInspectorControl(): InspectorControlValue {
  const control = useContext(InspectorControl)
  if (!control) {
    throw new Error('useInspectorControl must be used within an InspectorProvider')
  }
  return control
}
