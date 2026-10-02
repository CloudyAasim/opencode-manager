import { useEffect, useCallback, useRef, useState } from 'react'
import { useSettings } from './useSettings'
import { DEFAULT_DIRECT_SHORTCUTS, DEFAULT_LEADER_KEY } from '@/api/types/settings'
import { matchesUserShortcut, normalizeShortcut, parseEventShortcut } from '@/framework/commands/shortcutMatch'
import { getShortcutAction } from '@/framework/commands/shortcutRegistry'

const LEADER_TIMEOUT = 1500

export function useKeyboardShortcuts(actions: Record<string, (() => void) | undefined> = {}) {
  const { preferences } = useSettings()
  const [leaderActive, setLeaderActive] = useState(false)
  const leaderTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const preferencesRef = useRef(preferences)
  preferencesRef.current = preferences

  const actionsRef = useRef(actions)
  actionsRef.current = actions

  const clearLeaderTimeout = useCallback(() => {
    if (leaderTimeoutRef.current) {
      clearTimeout(leaderTimeoutRef.current)
      leaderTimeoutRef.current = null
    }
  }, [])

  const executeAction = useCallback((action: string, e: KeyboardEvent) => {
    const run = actionsRef.current[action] ?? getShortcutAction(action)
    if (!run) return
    e.preventDefault()
    run()
  }, [])

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    const shortcut = parseEventShortcut(e)
    if (!shortcut) return

    const prefs = preferencesRef.current
    const shortcuts = prefs?.keyboardShortcuts || {}
    const leaderKey = normalizeShortcut(prefs?.leaderKey || DEFAULT_LEADER_KEY)
    const directShortcuts = prefs?.directShortcuts ?? DEFAULT_DIRECT_SHORTCUTS
    
    const activeFileEditor = document.querySelector('[data-file-editor="true"]')
    if (activeFileEditor && document.activeElement === activeFileEditor) {
      return
    }
    
    const target = e.target instanceof HTMLElement ? e.target : null
    const isInInput = target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA' || target?.contentEditable === 'true'
    const isFileEditor = target?.getAttribute('data-file-editor') === 'true'
    
    if (isFileEditor) return

    if (leaderActive) {
      clearLeaderTimeout()
      setLeaderActive(false)
      
      const action = Object.entries(shortcuts).find(([actionName, keys]) => {
        if (directShortcuts.includes(actionName)) return false
        if (!keys) return false
        return matchesUserShortcut(e, keys)
      })?.[0]
      
      if (action) {
        executeAction(action, e)
      }
      return
    }

    if (shortcut === leaderKey && !isInInput) {
      e.preventDefault()
      setLeaderActive(true)
      clearLeaderTimeout()
      leaderTimeoutRef.current = setTimeout(() => {
        setLeaderActive(false)
      }, LEADER_TIMEOUT)
      return
    }

    const directAction = Object.entries(shortcuts).find(([actionName, keys]) => {
      if (!directShortcuts.includes(actionName)) return false
      if (!keys) return false
      return matchesUserShortcut(e, keys)
    })?.[0]
    
    if (directAction) {
      executeAction(directAction, e)
    }
  }, [leaderActive, clearLeaderTimeout, executeAction])

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      clearLeaderTimeout()
    }
  }, [handleKeyDown, clearLeaderTimeout])

  return { leaderActive }
}