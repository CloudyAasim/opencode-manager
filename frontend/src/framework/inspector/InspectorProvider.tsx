import { useCallback, useMemo, type ReactNode } from 'react'
import { usePersistentBooleanState } from '@/hooks/usePersistentBooleanState'
import { usePersistentStringState } from '@/hooks/usePersistentStringState'
import { STORAGE_KEYS } from '@/lib/storage-keys'
import { InspectorControl } from './control'
import { orderInspectorTabs } from './registry'
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

  const [storedOrder, setStoredOrder] = usePersistentStringState({
    storageKey: STORAGE_KEYS.inspectorTabOrder,
    defaultValue: '',
  })

  const list = useMemo(() => {
    const order = orderInspectorTabs([...tabs.keys()], storedOrder || null)
    return order.map((id) => tabs.get(id)).filter((tab): tab is NonNullable<typeof tab> => Boolean(tab))
  }, [tabs, storedOrder])
  const activeTab = list.some((tab) => tab.id === storedTab) ? storedTab : (list[0]?.id ?? '')

  const selectTab = useCallback((id: string) => setStoredTab(id), [setStoredTab])
  const moveTab = useCallback(
    (from: number, to: number) => {
      const next = list.map((tab) => tab.id)
      if (from < 0 || from >= next.length || to < 0 || to >= next.length || from === to) return
      const [moved] = next.splice(from, 1)
      next.splice(to, 0, moved!)
      setStoredOrder(next.join(','))
    },
    [list, setStoredOrder],
  )
  const open = useCallback(
    (tab?: string) => {
      if (tab) setStoredTab(tab)
      setIsOpen(true)
    },
    [setIsOpen, setStoredTab],
  )
  const close = useCallback(() => setIsOpen(false), [setIsOpen])

  const control = useMemo(
    () => ({ isOpen, activeTab, tabs: list, open, close, toggle: toggleOpen, selectTab, moveTab }),
    [isOpen, activeTab, list, open, close, toggleOpen, selectTab, moveTab],
  )

  return (
    <InspectorRegistry.Provider value={{ register }}>
      <InspectorTabList.Provider value={tabs}>
        <InspectorControl.Provider value={control}>{children}</InspectorControl.Provider>
      </InspectorTabList.Provider>
    </InspectorRegistry.Provider>
  )
}
