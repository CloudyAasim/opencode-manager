import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ContextUsageIndicator } from './ContextUsageIndicator'

const useContextUsage = vi.hoisted(() => vi.fn())
const useMediaQuery = vi.hoisted(() => vi.fn(() => true))

vi.mock('@/hooks/useContextUsage', () => ({ useContextUsage }))
vi.mock('@/hooks/useMediaQuery', () => ({ useMediaQuery }))

function usage(overrides: Record<string, unknown> = {}) {
  return {
    totalTokens: 12345,
    contextLimit: 200000,
    usagePercentage: 42,
    isLoading: false,
    ...overrides,
  }
}

beforeEach(() => {
  useContextUsage.mockReset()
  useMediaQuery.mockReturnValue(true)
})

describe('ContextUsageIndicator', () => {
  it('shows a labelled percentage with a token tooltip', () => {
    useContextUsage.mockReturnValue(usage())

    render(
      <ContextUsageIndicator opcodeUrl="http://x" sessionID="s1" isConnected isReconnecting={false} />,
    )

    expect(screen.getByText('Context')).toBeInTheDocument()
    expect(screen.getByText('42%')).toBeInTheDocument()
    expect(screen.getByTitle(/12,345 tokens used/)).toBeInTheDocument()
  })

  it('falls back to raw tokens when there is no context limit', () => {
    useContextUsage.mockReturnValue(usage({ contextLimit: null, usagePercentage: null }))

    render(
      <ContextUsageIndicator opcodeUrl="http://x" sessionID="s1" isConnected isReconnecting={false} />,
    )

    expect(screen.getByText('12,345')).toBeInTheDocument()
  })

  it('shows the disconnected state', () => {
    useContextUsage.mockReturnValue(usage())

    render(
      <ContextUsageIndicator opcodeUrl="http://x" sessionID="s1" isConnected={false} isReconnecting={false} />,
    )

    expect(screen.getByText('Disconnected')).toBeInTheDocument()
  })

  it('collapses to a bare dot on narrow viewports while reconnecting', () => {
    useMediaQuery.mockReturnValue(false)
    useContextUsage.mockReturnValue(usage())

    render(
      <ContextUsageIndicator opcodeUrl="http://x" sessionID="s1" isConnected isReconnecting />,
    )

    expect(screen.getByLabelText(/reconnect/i)).toBeInTheDocument()
    expect(screen.queryByText(/reconnect/i)).not.toBeInTheDocument()
  })

  it('keeps the percentage but drops the label on narrow viewports', () => {
    useMediaQuery.mockReturnValue(false)
    useContextUsage.mockReturnValue(usage())

    render(
      <ContextUsageIndicator opcodeUrl="http://x" sessionID="s1" isConnected isReconnecting={false} />,
    )

    expect(screen.getByLabelText(/12,345/)).toBeInTheDocument()
    expect(screen.getByText('42%')).toBeInTheDocument()
  })
})
