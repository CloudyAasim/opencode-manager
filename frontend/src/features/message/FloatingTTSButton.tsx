import { useState, useCallback, useRef } from 'react'
import { Volume2, VolumeX } from 'lucide-react'
import { useTTS } from '@/hooks/useTTS'
import { useSettings } from '@/hooks/useSettings'
import { showToast } from '@/lib/toast'
import { DEFAULT_TTS_CONFIG } from '@opencode-manager/shared'
import { useI18n } from '@/lib/i18n'
import { Button } from '@/components/ui/button'
import { useCancellableTimer } from '@/hooks/use-cancellable-timer'

interface FloatingTTSButtonProps {
  messageId: string
  content: string
}

const LONG_PRESS_DURATION = 500

export function FloatingTTSButton({ messageId, content }: FloatingTTSButtonProps) {
  const { speakMessage, stop, isPlaying, isLoading } = useTTS()
  const { preferences, updateSettings } = useSettings()
  const { t } = useI18n()

  const autoPlay = preferences?.tts?.autoPlay ?? false
  const [isLongPressVisual, setIsLongPressVisual] = useState(false)
  const didLongPressFireRef = useRef(false)
  const { schedule, cancel } = useCancellableTimer()

  const isAnyPlaybackActive = isPlaying || isLoading
  const hasContent = content.trim().length > 0

  const clearLongPressTimer = useCallback(() => {
    cancel('long-press')
  }, [cancel])

  const handlePointerDown = useCallback(() => {
    clearLongPressTimer()
    didLongPressFireRef.current = false
    schedule('long-press', () => {
      const nextAutoPlay = !autoPlay

      didLongPressFireRef.current = true
      setIsLongPressVisual(true)
      updateSettings({ tts: { ...(preferences?.tts ?? DEFAULT_TTS_CONFIG), autoPlay: nextAutoPlay } })
      showToast.info(nextAutoPlay ? t('message.tts.autoPlayEnabled') : t('message.tts.autoPlayDisabled'), {
        id: 'tts-autoplay-toggle',
        duration: 1800,
      })
    }, LONG_PRESS_DURATION)
  }, [autoPlay, updateSettings, preferences?.tts, clearLongPressTimer, t, schedule])

  const handlePointerUp = useCallback(() => {
    clearLongPressTimer()

    if (didLongPressFireRef.current) {
      didLongPressFireRef.current = false
      setIsLongPressVisual(false)
      return
    }

    setIsLongPressVisual(false)

    if (isAnyPlaybackActive) {
      stop()
      return
    }

    if (hasContent) {
      speakMessage(messageId, content)
    }
  }, [clearLongPressTimer, isAnyPlaybackActive, stop, speakMessage, messageId, content, hasContent])

  const handlePointerLeave = useCallback(() => {
    clearLongPressTimer()
    didLongPressFireRef.current = false
    setIsLongPressVisual(false)
  }, [clearLongPressTimer])

  const showStop = isAnyPlaybackActive
  const pillTitle = showStop
    ? t('message.actions.stopPlayback')
    : hasContent
      ? t('message.tts.playLatestReply')
      : t('message.tts.controls')
  const pillAriaLabel = t('message.tts.ariaLabel', {
    title: pillTitle,
    autoPlay: autoPlay ? t('message.tts.autoPlayEnabledState') : t('message.tts.autoPlayDisabledState'),
  })
  return (
      <Button
        variant={showStop ? 'destructive' : autoPlay ? 'default' : 'warning'}
        size="default"
        onPointerDown={handlePointerDown}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerLeave}
        className={`transition-all duration-200 backdrop-blur-md ${isLongPressVisual ? 'scale-95 opacity-80' : 'active:scale-95 hover:scale-105'} ${!hasContent && !autoPlay ? 'opacity-50 cursor-not-allowed' : ''}`}
        title={pillTitle}
        aria-label={pillAriaLabel}
        disabled={!hasContent && !autoPlay}
      >
        {showStop ? (
          <VolumeX className="size-5" />
        ) : hasContent || autoPlay ? (
          <Volume2 className="size-5" />
        ) : null}
      </Button>
  )
}
