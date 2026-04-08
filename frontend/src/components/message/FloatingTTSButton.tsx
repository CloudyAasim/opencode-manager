import { Volume2, VolumeX, Loader2 } from 'lucide-react'
import { useTTS } from '@/hooks/useTTS'

interface FloatingTTSButtonProps {
  content: string
}

export function FloatingTTSButton({ content }: FloatingTTSButtonProps) {
  const { speak, stop, isEnabled, isPlaying, isLoading, originalText } = useTTS()
  
  if (!isEnabled || !content.trim()) {
    return null
  }
  
  const isThisPlaying = (isPlaying || isLoading) && originalText === content
  
  const handleClick = () => {
    if (isThisPlaying) {
      stop()
    } else {
      speak(content)
    }
  }
  
  return (
    <button
      onClick={handleClick}
      className={`absolute -top-5 right-0 md:right-4 z-50 flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition-all duration-200 active:scale-95 hover:scale-105 shadow-md backdrop-blur-md ring-1 ${
        isThisPlaying
          ? 'bg-gradient-to-br from-red-600 to-red-700 hover:from-red-500 hover:to-red-600 text-destructive-foreground border border-red-500/60 shadow-red-500/30 ring-red-500/20 hover:ring-red-500/40'
          : 'bg-gradient-to-br from-amber-500 to-orange-600 hover:from-amber-400 hover:to-orange-500 text-white border border-amber-400/60 shadow-amber-500/30 ring-amber-500/20 hover:ring-amber-500/40'
      }`}
      title={isThisPlaying ? 'Stop playback' : 'Play last response'}
      aria-label={isThisPlaying ? 'Stop playback' : 'Play last response'}
      disabled={isLoading && originalText !== content}
    >
      {isLoading && isThisPlaying ? (
        <Loader2 className="w-5 h-5 animate-spin" />
      ) : isThisPlaying ? (
        <VolumeX className="w-5 h-5" />
      ) : (
        <Volume2 className="w-5 h-5" />
      )}
      <span className="text-sm font-medium hidden sm:inline">
        {isThisPlaying ? 'Stop' : 'Play Last'}
      </span>
    </button>
  )
}
