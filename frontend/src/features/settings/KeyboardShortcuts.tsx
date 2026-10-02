import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { useSettings } from '@/hooks/useSettings'
import { useMobile } from '@/hooks/useMobile'
import { Loader2, X } from 'lucide-react'
import { DEFAULT_DIRECT_SHORTCUTS, DEFAULT_KEYBOARD_SHORTCUTS, DEFAULT_LEADER_KEY } from '@/api/types/settings'
import { ALL_KEYBOARD_ACTIONS, CONVERSATION_ACTIONS, NAVIGATION_ACTIONS } from '@/framework/commands/keyboardActions'
import { normalizeShortcut, parseEventShortcut, parseModifierShortcut } from '@/framework/commands/shortcutMatch'
import { useI18n } from '@/lib/i18n'

const formatShortcutLabel = (action: string): string => {
  return action.replace(/([A-Z])/g, ' $1').trim()
}

interface ShortcutGroup {
  title: string
  actions: string[]
}

const buildShortcutGroups = (
  shortcuts: Record<string, string>,
  titles: { conversationActions: string; navigation: string },
): ShortcutGroup[] => {
  const knownActions = new Set(ALL_KEYBOARD_ACTIONS)
  const unknownActions = Object.keys(shortcuts).filter((action) => !knownActions.has(action))
  return [
    {
      title: titles.conversationActions,
      actions: CONVERSATION_ACTIONS.filter((action) => action in shortcuts),
    },
    {
      title: titles.navigation,
      actions: [...NAVIGATION_ACTIONS.filter((action) => action in shortcuts), ...unknownActions],
    },
  ]
}

interface RecordingInputProps {
  value: string
  onStop: () => void
}

function RecordingInput({ value, onStop }: RecordingInputProps) {
  const { t } = useI18n()
  return (
    <div className="flex min-w-0 max-w-full items-center gap-2">
      <input
        type="text"
        className="min-w-0 w-44 px-3 py-1.5 bg-accent border border-primary rounded text-[16px] md:text-sm text-foreground font-mono outline-none"
        placeholder={t('settingsPanels.shortcuts.pressKeys')}
        value={value || ''}
        autoFocus
        onBlur={onStop}
        readOnly
      />
      <button
        onClick={onStop}
        className="px-2 py-1 text-xs text-muted-foreground hover:text-foreground"
      >
        {t('settingsPanels.shortcuts.cancel')}
      </button>
    </div>
  )
}

interface ShortcutRowProps {
  action: string
  keys: string
  isDirect: boolean
  display: string
  isRecording: boolean
  currentKeys: string
  onToggleDirect: (action: string) => void
  onStartRecording: (action: string) => void
  onStopRecording: () => void
  onClear: (action: string) => void
}

function ShortcutRow({ action, keys, isDirect, display, isRecording, currentKeys, onToggleDirect, onStartRecording, onStopRecording, onClear }: ShortcutRowProps) {
  const { t } = useI18n()
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 py-2.5 border-b border-border last:border-0">
      <div className="min-w-0 flex-1 basis-48 space-y-0.5">
        <p className="truncate text-sm font-medium capitalize text-foreground">{formatShortcutLabel(action)}</p>
        <button
          onClick={() => onToggleDirect(action)}
          className="text-xs text-muted-foreground hover:text-foreground transition-colors text-left"
        >
          {isDirect ? t('settingsPanels.shortcuts.directHint') : t('settingsPanels.shortcuts.leaderHint')}
        </button>
      </div>

      {isRecording ? (
        <RecordingInput value={currentKeys} onStop={onStopRecording} />
      ) : (
        <div className="flex items-center gap-2">
          <button
            onClick={() => onStartRecording(action)}
            className={`px-3 py-1.5 bg-accent border border-border hover:border-border rounded text-sm font-mono transition-colors ${keys ? 'text-foreground' : 'text-muted-foreground italic'}`}
          >
            {display}
          </button>
          {keys && (
            <button
              onClick={() => onClear(action)}
              className="p-1 text-muted-foreground hover:text-destructive transition-colors"
              title={t('settingsPanels.shortcuts.clearShortcut')}
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      )}
    </div>
  )
}

export function KeyboardShortcuts() {
  const { t } = useI18n()
  const { preferences, isLoading, updateSettings } = useSettings()
  const isMobile = useMobile()
  const [recordingKey, setRecordingKey] = useState<string | null>(null)
  const [recordingLeader, setRecordingLeader] = useState(false)
  const [tempShortcuts, setTempShortcuts] = useState<Record<string, string>>({})
  const [tempLeaderKey, setTempLeaderKey] = useState<string | null>(null)
  const [currentKeys, setCurrentKeys] = useState<string>('')

  const leaderKey = tempLeaderKey ?? preferences?.leaderKey ?? DEFAULT_LEADER_KEY
  const directShortcuts = preferences?.directShortcuts ?? DEFAULT_DIRECT_SHORTCUTS

  const shortcuts = useMemo(() => ({
    ...DEFAULT_KEYBOARD_SHORTCUTS,
    ...preferences?.keyboardShortcuts,
    ...tempShortcuts
  }), [preferences?.keyboardShortcuts, tempShortcuts])

  const shortcutGroups = useMemo(
    () => buildShortcutGroups(shortcuts, {
      conversationActions: t('settingsPanels.shortcuts.conversationActions'),
      navigation: t('settingsPanels.shortcuts.navigation'),
    }),
    [shortcuts, t],
  )

  const shortcutsRef = useRef(shortcuts)
  shortcutsRef.current = shortcuts

  const updateSettingsRef = useRef(updateSettings)
  updateSettingsRef.current = updateSettings

  const startRecording = (action: string) => {
    setRecordingKey(action)
    setRecordingLeader(false)
    setCurrentKeys('')
  }

  const startRecordingLeader = () => {
    setRecordingLeader(true)
    setRecordingKey(null)
    setCurrentKeys('')
  }

  const stopRecording = useCallback(() => {
    setRecordingKey(null)
    setRecordingLeader(false)
    setCurrentKeys('')
  }, [])

  const clearShortcut = useCallback((action: string) => {
    setTempShortcuts(prev => ({ ...prev, [action]: '' }))
    updateSettingsRef.current({
      keyboardShortcuts: { ...shortcutsRef.current, [action]: '' }
    })
  }, [])

  useEffect(() => {
    if (!recordingKey && !recordingLeader) return

    const handleKeyDown = (e: KeyboardEvent) => {
      e.preventDefault()

      const shortcut = parseEventShortcut(e)
      if (!shortcut) {
        setCurrentKeys(parseModifierShortcut(e))
        return
      }

      if (recordingLeader) {
        setTempLeaderKey(shortcut)
        setRecordingLeader(false)
        setCurrentKeys('')
        updateSettingsRef.current({ leaderKey: shortcut })
      } else if (recordingKey) {
        setTempShortcuts(prev => ({ ...prev, [recordingKey]: shortcut }))
        setRecordingKey(null)
        setCurrentKeys('')
        updateSettingsRef.current({
          keyboardShortcuts: { ...shortcutsRef.current, [recordingKey]: shortcut }
        })
      }
    }

    const handleKeyUp = (e: KeyboardEvent) => {
      setCurrentKeys(parseModifierShortcut(e))
    }

    document.addEventListener('keydown', handleKeyDown)
    document.addEventListener('keyup', handleKeyUp)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      document.removeEventListener('keyup', handleKeyUp)
    }
  }, [recordingKey, recordingLeader])

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  const formatShortcutDisplay = (action: string, keys: string) => {
    if (!keys) return t('settingsPanels.shortcuts.notSet')
    if (directShortcuts.includes(action)) {
      return normalizeShortcut(keys)
    }
    return `${normalizeShortcut(leaderKey)} → ${normalizeShortcut(keys)}`
  }

  const toggleDirectShortcut = (action: string) => {
    const newDirectShortcuts = directShortcuts.includes(action)
      ? directShortcuts.filter(s => s !== action)
      : [...directShortcuts, action]
    updateSettings({ directShortcuts: newDirectShortcuts })
  }

  if (isMobile) {
    return (
      <div className="bg-card border border-border rounded-lg p-6">
        <h2 className="text-lg font-semibold text-foreground mb-4">{t('settingsPanels.shortcuts.title')}</h2>
        <p className="text-sm text-muted-foreground">
          {t('settingsPanels.shortcuts.mobileUnavailable')}
        </p>
      </div>
    )
  }

  return (
    <div className="bg-card border border-border rounded-lg p-6">
      <h2 className="text-lg font-semibold text-foreground mb-6">{t('settingsPanels.shortcuts.title')}</h2>

      <div className="flex flex-wrap items-center justify-between gap-2 py-3 border-b border-border">
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-2">
          <p className="text-sm font-medium text-foreground">{t('settingsPanels.shortcuts.leaderKey')}</p>
          <p className="text-xs text-muted-foreground">{t('settingsPanels.shortcuts.leaderKeyDescription')}</p>
        </div>

        {recordingLeader ? (
          <RecordingInput value={currentKeys} onStop={stopRecording} />
        ) : (
          <button
            onClick={startRecordingLeader}
            className="px-3 py-1.5 bg-primary/20 border border-primary/50 hover:border-primary rounded text-sm text-foreground font-mono transition-colors"
          >
            {normalizeShortcut(leaderKey)}
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 gap-6 pt-4 @min-[1000px]:grid-cols-2 @min-[1000px]:items-start">
        {shortcutGroups.map((group) => (
          <section key={group.title} className="min-w-0" aria-label={group.title}>
            <h3 className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">{group.title}</h3>
            <div>
              {group.actions.map((action) => (
                <ShortcutRow
                  key={action}
                  action={action}
                  keys={shortcuts[action] ?? ''}
                  isDirect={directShortcuts.includes(action)}
                  display={formatShortcutDisplay(action, shortcuts[action] ?? '')}
                  isRecording={recordingKey === action}
                  currentKeys={currentKeys}
                  onToggleDirect={toggleDirectShortcut}
                  onStartRecording={startRecording}
                  onStopRecording={stopRecording}
                  onClear={clearShortcut}
                />
              ))}
            </div>
          </section>
        ))}
      </div>

      <p className="mt-6 text-sm text-muted-foreground">
        {t('settingsPanels.shortcuts.footer')}
      </p>
    </div>
  )
}
