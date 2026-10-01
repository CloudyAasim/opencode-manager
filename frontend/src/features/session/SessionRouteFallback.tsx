import { useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/button'

interface SessionRouteFallbackProps {
  message: string
  backTo: string
  backLabel: string
}

export function SessionRouteFallback({ message, backTo, backLabel }: SessionRouteFallbackProps) {
  const navigate = useNavigate()
  return (
    <div className="flex items-center justify-center min-h-screen bg-background">
      <div className="flex flex-col items-center gap-3 text-center">
        <span className="text-muted-foreground">{message}</span>
        <Button variant="outline" size="sm" onClick={() => navigate(backTo)}>{backLabel}</Button>
      </div>
    </div>
  )
}
