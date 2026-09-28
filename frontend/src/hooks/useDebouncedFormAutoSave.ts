import { useEffect, useRef, useState } from 'react'

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
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const feedbackTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastSavedRef = useRef<T | null>(null)

  useEffect(() => {
    if (!enabled || !isDirty || !isValid) {
      return
    }

    const timer = setTimeout(() => {
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
    saveTimeoutRef.current = timer

    return () => {
      clearTimeout(timer)
    }
  }, [watchedValues, isDirty, isValid, enabled, delay, getValues, onSave, skipIfUnchanged])

  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current)
      if (feedbackTimeoutRef.current) clearTimeout(feedbackTimeoutRef.current)
    }
  }, [])

  function scheduleFeedbackReset() {
    if (feedbackTimeoutRef.current) {
      clearTimeout(feedbackTimeoutRef.current)
    }
    feedbackTimeoutRef.current = setTimeout(() => {
      setStatus('idle')
    }, feedbackDuration)
  }

  return status
}
