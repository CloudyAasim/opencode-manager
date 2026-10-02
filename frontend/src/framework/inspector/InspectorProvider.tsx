import { useCallback, useMemo, type ReactNode } from 'react'
import { usePersistentBooleanState } from '@/hooks/usePersistentBooleanState'
import { usePersistentStringState } from '@/hooks/usePersistentStringState'
import { STORAGE_KEYS } from '@/lib/storage-keys'
import { InspectorControl } from './control'
import { InspectorRegistry, InspectorTabList, useInspectorTabStore } from './registry'

export function InspectorProvider({ children }: { children: ReactNode }) {
  const { tabs, register } = useInspectorTabStore()
  const [isOpen, setIsOpen, toggleOpen] = usePersistentBooleanState({
    storageKey: STORAGE_KEYS.inspectorOpen,
    defaultValue: false,
  })
  const [storedTab, setStoredTab] = usePersistentStringState({
    storageKey: STORAGE_KEYS.inspectorTab,
    defaultValue: '',
  })

  const list = useMemo(() => [...tabs.values()], [tabs])
  const activeTab = list.some((tab) => tab.id === storedTab) ? storedTab : (list[0]?.id ?? '')

  const selectTab = useCallback((id: string) => setStoredTab(id), [setStoredTab])
  const open = useCallback(
    (tab?: string) => {
      if (tab) setStoredTab(tab)
      setIsOpen(true)
    },
    [setIsOpen, setStoredTab],
  )
  const close = useCallback(() => setIsOpen(false), [setIsOpen])

  const control = useMemo(
    () => ({ isOpen, activeTab, tabs: list, open, close, toggle: toggleOpen, selectTab }),
    [isOpen, activeTab, list, open, close, toggleOpen, selectTab],
  )

  return (
    <InspectorRegistry.Provider value={{ register }}>
      <InspectorTabList.Provider value={tabs}>
        <InspectorControl.Provider value={control}>{children}</InspectorControl.Provider>
      </InspectorTabList.Provider>
    </InspectorRegistry.Provider>
  )
}
