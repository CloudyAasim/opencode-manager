import { useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { PanelMessage } from '@/components/ui/panel-message'
import { Compass } from 'lucide-react'

interface SessionRouteFallbackProps {
  message: string
  backTo: string
  backLabel: string
}

export function SessionRouteFallback({ message, backTo, backLabel }: SessionRouteFallbackProps) {
  const navigate = useNavigate()
  return (
    <div className="flex items-center justify-center min-h-screen bg-background">
      <PanelMessage
        icon={<Compass />}
        title={message}
        action={
          <Button variant="outline" size="sm" onClick={() => navigate(backTo)}>{backLabel}</Button>
        }
      />
    </div>
  )
}
