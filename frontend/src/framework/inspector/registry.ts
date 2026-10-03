import { createContext, useContext, useEffect, useMemo, useState, type ComponentType, type ReactNode } from 'react'

/**
 * The order the tabs are meant to appear in, decided once. `details` is listed
 * even though nothing registers it yet: when it arrives it lands in the right
 * slot instead of needing another edit, and until then the list is simply
 * shorter than the constant.
 */
export const DEFAULT_INSPECTOR_TAB_ORDER: readonly string[] = [
  'files',
  'terminal',
  'source-control',
  'details',
]

/**
 * Resolve which tab goes where, given what is registered and what the user last
 * dragged. Tabs that are not registered are skipped, and tabs that are
 * registered but unlisted go last - a new tab appearing should not silently
 * reshuffle the ones the user already arranged.
 */
export function orderInspectorTabs(registered: readonly string[], stored: string | null): string[] {
  const present = new Set(registered)
  const chosen: string[] = []
  const seen = new Set<string>()

  for (const id of (stored ?? '').split(',')) {
    const trimmed = id.trim()
    if (!trimmed || seen.has(trimmed)) continue
    if (!present.has(trimmed)) continue
    seen.add(trimmed)
    chosen.push(trimmed)
  }

  if (chosen.length === 0) {
    for (const id of DEFAULT_INSPECTOR_TAB_ORDER) {
      if (present.has(id) && !seen.has(id)) {
        seen.add(id)
        chosen.push(id)
      }
    }
  }

  for (const id of registered) {
    if (!seen.has(id)) chosen.push(id)
  }
  return chosen
}

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
