type SessionKeyedItem = { id: string; sessionId: string }
type SessionKeyedState<T> = Record<string, T[]>
type StateSetter<T> = React.Dispatch<React.SetStateAction<SessionKeyedState<T>>>

export function addToSessionKeyedState<T extends SessionKeyedItem>(
  setter: StateSetter<T>,
  item: T
): void {
  setter(prev => {
    const sessionId = item.sessionId
    const existing = prev[sessionId] ?? []
    const existingIndex = existing.findIndex(i => i.id === item.id)
    
    if (existingIndex >= 0) {
      const updated = [...existing]
      updated[existingIndex] = item
      return { ...prev, [sessionId]: updated }
    }
    return { ...prev, [sessionId]: [...existing, item] }
  })
}

export function removeFromSessionKeyedState<T extends SessionKeyedItem>(
  setter: StateSetter<T>,
  id: string,
  sessionId?: string
): void {
  setter(prev => {
    if (sessionId) {
      const existing = prev[sessionId]
      if (!existing) return prev
      const filtered = existing.filter(i => i.id !== id)
      if (filtered.length === 0) {
        const { [sessionId]: _removed, ...rest } = prev
      void _removed
        return rest
      }
      return { ...prev, [sessionId]: filtered }
    }
    
    const newState: SessionKeyedState<T> = {}
    for (const [sid, items] of Object.entries(prev)) {
      const filtered = items.filter(i => i.id !== id)
      if (filtered.length > 0) newState[sid] = filtered
    }
    return newState
  })
}
