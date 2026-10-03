import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MinimizedQuestionIndicator } from './MinimizedQuestionIndicator'
import type { QuestionRequest } from '@/api/types'

const question = {
  id: 'q-1',
  sessionID: 's-1',
  questions: [{ header: 'Pick a branch', options: [] }],
} as unknown as QuestionRequest

/**
 * The dismiss button used to carry `hidden sm:block`, which on a phone meant
 * the minimised question could be expanded again but never dismissed - and it
 * had no accessible name at any width, since it renders a bare icon.
 */
describe('最小化后的提问', () => {
  it('仍然可以直接关闭，不被断点藏起来', () => {
    const onDismiss = vi.fn()
    render(
      <MinimizedQuestionIndicator question={question} onRestore={vi.fn()} onDismiss={onDismiss} />,
    )

    const dismiss = screen.getByRole('button', { name: 'Close' })

    expect(dismiss.className).not.toContain('hidden')

    fireEvent.click(dismiss)
    expect(onDismiss).toHaveBeenCalled()
  })

  it('点标题是展开而不是关闭', () => {
    const onRestore = vi.fn()
    const onDismiss = vi.fn()
    render(
      <MinimizedQuestionIndicator question={question} onRestore={onRestore} onDismiss={onDismiss} />,
    )

    fireEvent.click(screen.getByText(/Pick a branch/))

    expect(onRestore).toHaveBeenCalled()
    expect(onDismiss).not.toHaveBeenCalled()
  })
})
