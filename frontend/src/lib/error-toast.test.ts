import { describe, it, expect, vi, beforeEach } from 'vitest'
import { toast } from 'sonner'
import { showErrorToast } from './error-toast'

vi.mock('sonner', () => ({
  toast: { error: vi.fn() },
}))

describe('showErrorToast', () => {
  beforeEach(() => {
    vi.mocked(toast.error).mockClear()
  })

  it('uses the error message when the error carries one', () => {
    showErrorToast(new Error('permission denied'), 'fallback')
    expect(toast.error).toHaveBeenCalledWith('permission denied')
  })

  it('falls back when the value is not an Error', () => {
    showErrorToast('just a string', 'fallback')
    expect(toast.error).toHaveBeenCalledWith('fallback')
  })

  it('falls back when the Error has an empty message', () => {
    showErrorToast(new Error(''), 'fallback')
    expect(toast.error).toHaveBeenCalledWith('fallback')
  })

  it('falls back for null and undefined', () => {
    showErrorToast(null, 'fallback')
    showErrorToast(undefined, 'fallback')
    expect(toast.error).toHaveBeenCalledTimes(2)
    expect(toast.error).toHaveBeenNthCalledWith(2, 'fallback')
  })

  it('unwraps an error-shaped object', () => {
    showErrorToast({ message: 'server said no' }, 'fallback')
    expect(toast.error).toHaveBeenCalledWith('fallback')
  })
})
