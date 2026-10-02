import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ShellFrame } from './ShellFrame'

vi.mock('@/hooks/useDesktop', () => ({ useDesktop: () => true }))

function frame(chrome: boolean) {
  const ref = { current: null }
  render(
    <ShellFrame
      rootRef={ref}
      chrome={chrome}
      header={<div data-testid="header" />}
      rail={<div data-testid="rail" />}
      inspector={<div data-testid="inspector" />}
      main={<div data-testid="main" />}
      status={<div data-testid="status" />}
    />,
  )
  return {
    header: screen.queryByTestId('header'),
    rail: screen.queryByTestId('rail'),
    inspector: screen.queryByTestId('inspector'),
    bottom: screen.queryByTestId('bottom'),
    status: screen.queryByTestId('status'),
    main: screen.queryByTestId('main'),
  }
}

describe('shell frame', () => {
  it('draws the desktop chrome when there is a session', () => {
    const seen = frame(true)
    for (const name of ['header', 'rail', 'inspector', 'status', 'main'] as const) {
      expect(seen[name], `${name} should render with chrome`).not.toBeNull()
    }
    // bottom is the mobile tab bar, and this run is desktop
    expect(seen.bottom).toBeNull()
  })

  it('draws only the main slot when there is no session', () => {
    const seen = frame(false)
    expect(seen.main).not.toBeNull()
    for (const name of ['header', 'rail', 'inspector', 'bottom', 'status'] as const) {
      expect(seen[name], `${name} must not render while signed out`).toBeNull()
    }
  })
})
