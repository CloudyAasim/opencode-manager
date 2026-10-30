import { ArrowUp, LoaderCircle, X } from 'lucide-react'
import { useI18n } from '@/lib/i18n'

export type VoiceStatusOverlayState = 'starting' | 'recording' | 'readyToSend' | 'processing' | 'sending'

interface VoiceStatusOverlayProps {
  show: boolean
  label: string | null
  state: VoiceStatusOverlayState | null
}

function WaveformBars() {
  return (
    <div className="flex items-end gap-1 h-8">
      {[0, 1, 2, 3, 4].map((i) => (
        <div
          key={i}
          className="w-1.5 rounded-full bg-white"
          style={{
            height: '100%',
            animation: `waveBar 0.9s ease-in-out infinite`,
            animationDelay: `${i * 0.12}s`,
          }}
        />
      ))}
      <style>{`
        @keyframes waveBar {
          0%, 100% { transform: scaleY(0.2); }
          50% { transform: scaleY(1); }
        }
      `}</style>
    </div>
  )
}

export function VoiceStatusOverlay({ show, label, state }: VoiceStatusOverlayProps) {
  const { t } = useI18n()

  if (!show || !label || !state) {
    return null
  }

  const isLoading = state === 'starting' || state === 'processing' || state === 'sending'
  const actionWords = state === 'readyToSend'
    ? [t('message.voice.release'), t('message.voice.to'), t('message.actions.send')]
    : [t('message.voice.swipe'), t('message.voice.to'), t('message.actions.send')]

  return (
    <div
      aria-live="polite"
      className="pointer-events-none absolute inset-x-0 bottom-0 z-10"
    >
      <span className="sr-only">{label}</span>
      <div className="animate-voice-overlay-in relative flex h-44 w-full flex-col items-center justify-between overflow-hidden rounded-xl border border-success/40 bg-gradient-to-t from-success via-success to-success px-1 py-4 text-white shadow-lg shadow-success">
        <div className="absolute inset-x-1 top-1 h-10 rounded-full bg-white/20 blur-sm" />
        <div className="relative flex flex-1 flex-col items-center justify-center gap-1">
          {isLoading ? (
            state === 'processing' ? (
              <WaveformBars />
            ) : (
              <LoaderCircle className="size-6 animate-spin" />
            )
          ) : (
            <>
              <ArrowUp className="size-8 animate-bounce" />
              <div className="flex flex-col items-center text-2xs font-bold uppercase leading-none tracking-tight">
                {actionWords.map((word) => (
                  <span key={word}>{word}</span>
                ))}
              </div>
            </>
          )}
        </div>
        {!isLoading && (
          <X className="relative size-4" />
        )}
      </div>
    </div>
  )
}
