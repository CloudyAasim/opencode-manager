import { createContext, useContext, useEffect, useMemo, useState, type ComponentType, type ReactNode } from 'react'

export interface InspectorTabDefinition {
  id: string
  labelKey: string
  icon: ComponentType<{ className?: string }>
  render: () => ReactNode
}

export interface InspectorRegistryValue {
  register: (tab: InspectorTabDefinition) => () => void
}

export const InspectorRegistry = createContext<InspectorRegistryValue | null>(null)
export const InspectorTabList = createContext<ReadonlyMap<string, InspectorTabDefinition>>(new Map())

export function useInspectorRegistry(): InspectorRegistryValue {
  const registry = useContext(InspectorRegistry)
  if (!registry) throw new Error('useInspectorRegistry must be used within an InspectorProvider')
  return registry
}

export function useRegisterInspectorTab(tab: InspectorTabDefinition): void {
  const { register } = useInspectorRegistry()
  useEffect(() => register(tab), [register, tab])
}

export function useInspectorTabStore() {
  const [tabs, setTabs] = useState<ReadonlyMap<string, InspectorTabDefinition>>(new Map())

  const register = useMemo(
    () => (tab: InspectorTabDefinition) => {
      setTabs((current) => {
        const next = new Map(current)
        next.set(tab.id, tab)
        return next
      })
      return () => {
        setTabs((current) => {
          if (!current.has(tab.id)) return current
          const next = new Map(current)
          next.delete(tab.id)
          return next
        })
      }
    },
    [],
  )

  return { tabs, register }
}
