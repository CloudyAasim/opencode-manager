import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ShellFrame } from './ShellFrame'

function frame(chrome: boolean) {
  const ref = { current: null }
  render(
    <ShellFrame
      rootRef={ref}
      chrome={chrome}
      header={<div data-testid="header" />}
      inspector={<div data-testid="inspector" />}
      main={<div data-testid="main" />}
      status={<div data-testid="status" />}
    />,
  )
  return {
    header: screen.queryByTestId('header'),
    inspector: screen.queryByTestId('inspector'),
    status: screen.queryByTestId('status'),
    main: screen.queryByTestId('main'),
  }
}

describe('shell frame', () => {
  it('draws the chrome when there is a session', () => {
    const seen = frame(true)
    for (const name of ['header', 'inspector', 'status', 'main'] as const) {
      expect(seen[name], `${name} should render with chrome`).not.toBeNull()
    }
  })

  it('draws only the main slot when there is no session', () => {
    const seen = frame(false)
    expect(seen.main).not.toBeNull()
    for (const name of ['header', 'inspector', 'status'] as const) {
      expect(seen[name], `${name} must not render while signed out`).toBeNull()
    }
  })
})
