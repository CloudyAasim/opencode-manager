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
      main={<div data-testid="main" />}
      status={<div data-testid="status" />}
    />,
  )
  return {
    header: screen.queryByTestId('header'),
    status: screen.queryByTestId('status'),
    main: screen.queryByTestId('main'),
  }
}

describe('shell frame', () => {
  it('draws the chrome when there is a session', () => {
    const seen = frame(true)
    for (const name of ['header', 'status', 'main'] as const) {
      expect(seen[name], `${name} should render with chrome`).not.toBeNull()
    }
  })

  it('draws only the main slot when there is no session', () => {
    const seen = frame(false)
    expect(seen.main).not.toBeNull()
    for (const name of ['header', 'status'] as const) {
      expect(seen[name], `${name} must not render while signed out`).toBeNull()
    }
  })

  it('has no second column beside main', () => {
    // The shell used to take an `inspector` slot and render a right-hand
    // panel next to `main`. The session page already carries its own right
    // panel (files / source control / details / terminal), so the shell's copy
    // put two of them side by side. The slot is gone rather than hidden: an
    // empty column that a caller can still fill is how it came back.
    frame(true)

    const mainColumn = screen.getByTestId('main').parentElement!
    const contentRow = mainColumn.parentElement!
    const root = contentRow.parentElement!

    expect(contentRow.children, '外壳的横排里不该再有第二栏').toHaveLength(1)
    expect(root.children, '整块外壳只剩顶栏、内容、状态栏').toHaveLength(3)
  })
})
