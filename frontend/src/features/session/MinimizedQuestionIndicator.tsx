import { X } from 'lucide-react'
import type { QuestionRequest } from '@/api/types'
import { useI18n } from '@/lib/i18n'
import { Button } from '@/components/ui/button'

interface MinimizedQuestionIndicatorProps {
  question: QuestionRequest
  onRestore: () => void
  onDismiss: () => void
}

export function MinimizedQuestionIndicator({ 
  question, 
  onRestore, 
  onDismiss 
}: MinimizedQuestionIndicatorProps) {
  const { t } = useI18n()
  const questionCount = question.questions.length
  const firstQuestionHeader = question.questions[0]?.header
  
  return (
    <div className="w-full bg-card border border-border rounded-xl shadow-xs mb-2 overflow-hidden">
      <div className="flex items-center px-3 py-2 sm:px-4 sm:py-2.5 border-b border-border">
        <button
          onClick={onRestore}
          className="flex-1 text-left text-xs font-semibold text-foreground hover:text-primary transition-colors"
        >
          {questionCount === 1 
            ? t('session.question.minimizedQuestion', { header: firstQuestionHeader || t('session.question.minimizedPending') })
            : t('session.question.minimizedCount', { count: questionCount })
          }
        </button>
        <Button
          type="button"
          variant="ghost-destructive"
          size="icon"
          onClick={onDismiss}
          aria-label={t('navigation.close')}
          className="shrink-0 text-muted-foreground"
        >
          <X className="w-3.5 h-3.5" />
        </Button>
      </div>
    </div>
  )
}
