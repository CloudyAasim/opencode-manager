import { useCallback, useEffect, useRef, useState } from 'react'
import { useCancellableTimer } from './use-cancellable-timer'

export type AutoSaveStatus = 'idle' | 'saving' | 'saved' | 'error'

export interface UseDebouncedFormAutoSaveOptions<T> {
  watchedValues: ReadonlyArray<unknown>
  getValues: () => T
  onSave: (values: T) => void | Promise<void>
  isDirty: boolean
  isValid: boolean
  delay?: number
  feedbackDuration?: number
  skipIfUnchanged?: boolean
  enabled?: boolean
}

export function useDebouncedFormAutoSave<T>({
  watchedValues,
  getValues,
  onSave,
  isDirty,
  isValid,
  delay = 800,
  feedbackDuration = 1500,
  skipIfUnchanged = false,
  enabled = true,
}: UseDebouncedFormAutoSaveOptions<T>): AutoSaveStatus {
  const [status, setStatus] = useState<AutoSaveStatus>('idle')
  const lastSavedRef = useRef<T | null>(null)
  const { schedule, cancel } = useCancellableTimer()

  const scheduleFeedbackReset = useCallback(() => {
    schedule('feedback', () => {
      setStatus('idle')
    }, feedbackDuration)
  }, [feedbackDuration, schedule])

  useEffect(() => {
    if (!enabled || !isDirty || !isValid) {
      return
    }

    schedule('save', () => {
      const values = getValues()
      if (skipIfUnchanged && lastSavedRef.current !== null) {
        if (JSON.stringify(values) === JSON.stringify(lastSavedRef.current)) {
          return
        }
      }
      setStatus('saving')
      try {
        const result = onSave(values)
        if (result instanceof Promise) {
          result
            .then(() => {
              lastSavedRef.current = values
              setStatus('saved')
              scheduleFeedbackReset()
            })
            .catch(() => {
              setStatus('error')
              scheduleFeedbackReset()
            })
          return
        }
        lastSavedRef.current = values
        setStatus('saved')
        scheduleFeedbackReset()
      } catch {
        setStatus('error')
        scheduleFeedbackReset()
      }
    }, delay)

    return () => {
      cancel('save')
    }
  }, [watchedValues, isDirty, isValid, enabled, delay, getValues, onSave, skipIfUnchanged, scheduleFeedbackReset, schedule, cancel])

  return status
}
