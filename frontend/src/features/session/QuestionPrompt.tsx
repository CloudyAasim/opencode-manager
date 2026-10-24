import { useState, useEffect, useRef, useCallback } from 'react'
import { X, ChevronRight, ChevronDown, ChevronUp, Check, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import type { QuestionRequest, QuestionInfo } from '@/api/types'
import { cn } from '@/lib/utils'
import { showToast } from '@/lib/toast'
import { useI18n } from '@/lib/i18n'

interface QuestionPromptProps {
  question: QuestionRequest
  onReply: (requestID: string, answers: string[][]) => Promise<void>
  onReject: (requestID: string) => Promise<void>
  onMinimize?: () => void
}

export function QuestionPrompt({ question, onReply, onReject, onMinimize }: QuestionPromptProps) {
  const { t } = useI18n()
  const questions = question.questions
  const isSingleSelect = questions.length === 1 && !questions[0]?.multiple
  const totalSteps = isSingleSelect ? 1 : questions.length + 1

  const [isMinimized, setIsMinimized] = useState(false)
  const [currentIndex, setCurrentIndex] = useState(0)
  const [answers, setAnswers] = useState<string[][]>(() => questions.map(() => []))
  const [customInputs, setCustomInputs] = useState<string[]>(() => questions.map(() => ''))
  const [confirmedCustoms, setConfirmedCustoms] = useState<string[]>(() => questions.map(() => ''))
  const [expandedOther, setExpandedOther] = useState<number | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [touchStartY, setTouchStartY] = useState<number | null>(null)

  const handleMinimize = useCallback(() => {
    setIsMinimized(true)
    onMinimize?.()
  }, [onMinimize])

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    setTouchStartY(e.touches[0].clientY)
  }, [])

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (touchStartY === null) return
    const touchY = e.touches[0].clientY
    const diff = touchY - touchStartY
    if (diff > 100) {
      handleMinimize()
      setTouchStartY(null)
    }
  }, [touchStartY, handleMinimize])

  const handleTouchEnd = useCallback(() => {
    setTouchStartY(null)
  }, [])

  const isConfirmStep = !isSingleSelect && currentIndex === questions.length
  const currentQuestion = isConfirmStep ? null : questions[currentIndex]
  const isMultiSelect = currentQuestion?.multiple === true

  const goToNext = useCallback(() => {
    if (currentIndex < totalSteps - 1) {
      setCurrentIndex(prev => prev + 1)
      setExpandedOther(null)
    }
  }, [currentIndex, totalSteps])

  const handleSubmitSingle = useCallback(async (label: string) => {
    setIsSubmitting(true)
    try {
      await onReply(question.id, [[label]])
    } catch {
      showToast.error(t('session.question.submitAnswerFailed'))
    } finally {
      setIsSubmitting(false)
    }
  }, [onReply, question.id, t])

  const selectOption = useCallback((questionIndex: number, label: string) => {
    const isMultiple = questions[questionIndex]?.multiple
    
    setAnswers(prev => {
      const updated = [...prev]
      const current = updated[questionIndex] ?? []
      
      if (isMultiple) {
        const exists = current.includes(label)
        updated[questionIndex] = exists 
          ? current.filter(l => l !== label)
          : [...current, label]
      } else {
        updated[questionIndex] = [label]
      }
      return updated
    })

    if (!isMultiple) {
      if (isSingleSelect) {
        handleSubmitSingle(label)
      } else {
        setTimeout(() => goToNext(), 150)
      }
    }
  }, [questions, isSingleSelect, goToNext, handleSubmitSingle])

  const handleCustomInput = useCallback((questionIndex: number, value: string) => {
    setCustomInputs(prev => {
      const updated = [...prev]
      updated[questionIndex] = value
      return updated
    })
  }, [])

  const handleExpandOther = useCallback((questionIndex: number) => {
    if (!isMultiSelect) {
      setAnswers(prev => {
        const updated = [...prev]
        updated[questionIndex] = []
        return updated
      })
    }
    setConfirmedCustoms(prev => {
      const updated = [...prev]
      updated[questionIndex] = ''
      return updated
    })
    setExpandedOther(questionIndex)
  }, [isMultiSelect])

  const confirmCustomInput = useCallback((questionIndex: number) => {
    const value = customInputs[questionIndex]?.trim()
    if (!value) {
      setExpandedOther(null)
      return
    }

    const oldCustom = confirmedCustoms[questionIndex]
    
    setAnswers(prev => {
      const updated = [...prev]
      const current = updated[questionIndex] ?? []
      
      if (questions[questionIndex]?.multiple) {
        const withoutOld = oldCustom ? current.filter(l => l !== oldCustom) : current
        updated[questionIndex] = [...withoutOld, value]
      } else {
        updated[questionIndex] = [value]
        if (!isSingleSelect) {
          setTimeout(() => goToNext(), 150)
        }
      }
      return updated
    })
    
    setConfirmedCustoms(prev => {
      const updated = [...prev]
      updated[questionIndex] = value
      return updated
    })
    setExpandedOther(null)
    
    if (isSingleSelect) {
      handleSubmitSingle(value)
    }
  }, [customInputs, confirmedCustoms, questions, isSingleSelect, goToNext, handleSubmitSingle])

  const handleNext = useCallback(() => {
    if (expandedOther === currentIndex) {
      confirmCustomInput(currentIndex)
    } else {
      goToNext()
    }
  }, [expandedOther, currentIndex, confirmCustomInput, goToNext])

  const handleSubmit = async () => {
    setIsSubmitting(true)
    try {
      await onReply(question.id, answers)
    } catch {
      showToast.error(t('session.question.submitAnswersFailed'))
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleReject = async () => {
    setIsSubmitting(true)
    try {
      await onReject(question.id)
    } catch {
      showToast.error(t('session.question.dismissFailed'))
    } finally {
      setIsSubmitting(false)
    }
  }

  const hasAnswerForQuestion = (index: number) => {
    return (answers[index]?.length ?? 0) > 0
  }

  const allQuestionsAnswered = questions.every((_, i) => hasAnswerForQuestion(i))

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isMinimized && !expandedOther) {
        handleMinimize()
        onMinimize?.()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [isMinimized, expandedOther, handleMinimize, onMinimize])

  return (
    <div 
      className="w-full bg-gradient-to-br from-primary to-primary border-2 border-primary/40 rounded-xl shadow-lg shadow-primary mb-1 overflow-hidden"
    >
      <div className="flex items-center px-3 py-2 sm:px-4 sm:py-2.5 border-b border-primary/40 bg-primary/10">
        <button
          onClick={() => isMinimized ? setIsMinimized(false) : handleMinimize()}
          className="flex items-center gap-1.5 flex-1 text-left text-sm font-semibold text-primary dark:text-white"
        >
          {isMinimized
            ? <ChevronUp className="w-3 h-3 opacity-60 flex-shrink-0" />
            : <ChevronDown className="w-3 h-3 opacity-60 flex-shrink-0" />
          }
          {isConfirmStep ? t('session.question.review') : (currentQuestion?.header || t('session.question.headerFallback'))}
        </button>
        <button
          onClick={handleReject}
          disabled={isSubmitting}
          className="p-1.5 sm:p-2 hover:bg-destructive text-muted-foreground hover:text-destructive transition-colors"
        >
          <X className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
        </button>
      </div>

      {!isMinimized ? (
        <div 
          className="p-2 sm:p-3 max-h-[50vh] sm:max-h-[70vh] overflow-y-auto overflow-x-hidden bg-background/60 dark:bg-black/30"
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
        >
          {isConfirmStep ? (
            <ConfirmStep 
              questions={questions} 
              answers={answers} 
              onEditQuestion={setCurrentIndex}
            />
          ) : currentQuestion && (
            <QuestionStep
              question={currentQuestion}
              answers={answers[currentIndex] ?? []}
              customInput={customInputs[currentIndex] ?? ''}
              confirmedCustom={confirmedCustoms[currentIndex] ?? ''}
              expandedOther={expandedOther === currentIndex}
              isMultiSelect={isMultiSelect}
              onSelectOption={(label) => selectOption(currentIndex, label)}
              onExpandOther={() => handleExpandOther(currentIndex)}
              onCustomInputChange={(value) => handleCustomInput(currentIndex, value)}
              onConfirmCustomInput={() => confirmCustomInput(currentIndex)}
              onCollapseOther={() => setExpandedOther(null)}
            />
          )}
        </div>
      ) : null}

      <div className="flex gap-1.5 sm:gap-2 px-2 py-2 sm:px-3 sm:py-3 border-t border-primary/40">
        <Button
          size="sm"
          onClick={handleReject}
          disabled={isSubmitting}
          className="flex-1 h-8 sm:h-10 bg-muted hover:bg-muted/80 text-foreground"
        >
          {t('session.question.dismiss')}
        </Button>
        {!isSingleSelect && (
          isConfirmStep ? (
            <Button
              size="sm"
              onClick={handleSubmit}
              disabled={isSubmitting || !allQuestionsAnswered}
              className="flex-1 h-8 sm:h-10 bg-success hover:bg-success text-white"
            >
              {isSubmitting ? (
                <Loader2 className="w-3.5 h-3.5 sm:w-4 sm:h-4 animate-spin" />
              ) : (
                t('session.question.submit')
              )}
            </Button>
          ) : (
            <Button
              size="sm"
              onClick={handleNext}
              disabled={isSubmitting || (expandedOther === currentIndex && !customInputs[currentIndex]?.trim())}
              className="flex-1 h-8 sm:h-10 bg-success hover:bg-success text-white"
            >
              {expandedOther === currentIndex ? t('session.question.confirm') : t('session.question.next')}
            </Button>
          )
        )}
      </div>

      
    </div>
  )
}

interface QuestionStepProps {
  question: QuestionInfo
  answers: string[]
  customInput: string
  confirmedCustom: string
  expandedOther: boolean
  isMultiSelect: boolean
  onSelectOption: (label: string) => void
  onExpandOther: () => void
  onCustomInputChange: (value: string) => void
  onConfirmCustomInput: () => void
  onCollapseOther: () => void
}

function QuestionStep({
  question,
  answers,
  customInput,
  confirmedCustom,
  expandedOther,
  isMultiSelect,
  onSelectOption,
  onExpandOther,
  onCustomInputChange,
  onConfirmCustomInput,
  onCollapseOther,
}: QuestionStepProps) {
  const { t } = useI18n()
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (expandedOther && textareaRef.current) {
      textareaRef.current.focus()
      textareaRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }
  }, [expandedOther])

  const isCustomSelected = confirmedCustom && answers.includes(confirmedCustom)

  return (
    <div className="space-y-2 sm:space-y-3">
      <p className="text-sm font-semibold text-foreground">
        {question.question}
        {isMultiSelect && (
          <span className="text-foreground/60 font-normal ml-1">{t('session.question.selectAllThatApply')}</span>
        )}
      </p>

      <div className="space-y-1.5 sm:space-y-2">
        {question.options.map((option, i) => {
          const isSelected = answers.includes(option.label)
          return (
            <button
              key={i}
              onClick={() => onSelectOption(option.label)}
              className={cn(
                "w-full text-left p-2 sm:p-3 rounded-lg transition-all duration-200 active:scale-[0.98]",
                isSelected
                  ? "bg-primary/10"
                  : "bg-white/40 dark:bg-white/5 hover:bg-white/60 dark:hover:bg-white/10"
              )}
            >
              <div className="flex items-start justify-between gap-1.5 sm:gap-2">
                <div className="flex items-center gap-1.5 sm:gap-2 min-w-0">
                  <div className={cn(
                    "w-4 h-4 sm:w-5 sm:h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0 transition-colors",
                    isSelected 
                      ? "border-primary bg-primary" 
                      : "border-muted-foreground"
                  )}>
                    {isSelected && <Check className="w-2.5 h-2.5 sm:w-3 sm:h-3 text-white" />}
                  </div>
                  <span className={cn(
                    "text-sm font-semibold",
                    isSelected ? "text-primary" : "text-foreground"
                  )}>
                    {option.label}
                  </span>
                </div>
              </div>
              {option.description && (
                <p className="text-xs text-foreground/70 mt-0.5 sm:mt-1 ml-5 sm:ml-7">
                  {option.description}
                </p>
              )}
            </button>
          )
        })}

        <button
          onClick={() => {
            if (expandedOther) {
              onCollapseOther()
            } else {
              onExpandOther()
            }
          }}
          className={cn(
            "w-full text-left p-2 sm:p-3 rounded-lg transition-all duration-200",
            expandedOther || isCustomSelected
              ? "bg-primary/10"
              : "bg-white/40 dark:bg-white/5 hover:bg-white/60 dark:hover:bg-white/10"
          )}
        >
          <div className="flex items-center gap-1.5 sm:gap-2">
            <div className={cn(
              "w-4 h-4 sm:w-5 sm:h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0 transition-colors",
              isCustomSelected
                ? "border-primary bg-primary" 
                : "border-muted-foreground"
            )}>
              {isCustomSelected && <Check className="w-2.5 h-2.5 sm:w-3 sm:h-3 text-white" />}
            </div>
            <span className={cn(
              "text-sm font-semibold",
              expandedOther || isCustomSelected ? "text-primary" : "text-foreground"
            )}>
              {t('session.question.other')}
            </span>
          </div>
        </button>

        {expandedOther && (
          <div className="ml-5 sm:ml-7 space-y-1.5 sm:space-y-2 animate-in slide-in-from-top-2 duration-200">
            <Textarea
              ref={textareaRef}
              value={customInput}
              onChange={(e) => onCustomInputChange(e.target.value)}
              placeholder={t('session.question.customPlaceholder')}
              className="min-h-[60px] sm:min-h-[80px] resize-none border-primary focus:border-primary"
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  onConfirmCustomInput()
                }
                if (e.key === 'Escape') {
                  onCollapseOther()
                }
              }}
            />
          </div>
        )}

        {!expandedOther && isCustomSelected && (
          <div className="ml-5 sm:ml-7 text-xs text-muted-foreground">
            {confirmedCustom}
          </div>
        )}
      </div>
    </div>
  )
}

interface ConfirmStepProps {
  questions: QuestionInfo[]
  answers: string[][]
  onEditQuestion: (index: number) => void
}

function ConfirmStep({ questions, answers, onEditQuestion }: ConfirmStepProps) {
  const { t } = useI18n()
  return (
    <div className="space-y-2 sm:space-y-3">
      <p className="text-sm font-semibold text-foreground">{t('session.question.reviewAnswers')}</p>
      
      <div className="space-y-1.5 sm:space-y-2">
        {questions.map((q, i) => {
          const answer = answers[i] ?? []
          const hasAnswer = answer.length > 0
          return (
            <button
              key={i}
              onClick={() => onEditQuestion(i)}
              className={cn(
                "w-full text-left p-2 sm:p-3 rounded-lg transition-colors",
                hasAnswer 
                  ? "bg-success/10 hover:bg-success/10 dark:hover:bg-success" 
                  : "bg-destructive/10 hover:bg-destructive/10 dark:hover:bg-destructive"
              )}
            >
              <div className="flex items-start justify-between gap-1.5 sm:gap-2">
                <div className="min-w-0 flex-1">
                  <p className="text-xs text-muted-foreground truncate">{q.header}</p>
                  <p className={cn(
                    "text-sm font-semibold mt-0.5",
                    hasAnswer ? "text-success" : "text-destructive"
                  )}>
                    {hasAnswer ? answer.join(', ') : t('session.question.notAnswered')}
                  </p>
                </div>
                <ChevronRight className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-foreground/50 flex-shrink-0 mt-0.5 sm:mt-1" />
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}
