import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { Header } from './header'

const useMobile = vi.fn(() => false)

vi.mock('@/hooks/useMobile', () => ({
  useMobile: () => useMobile(),
  // The title's editor is a full-screen dialog on a phone, and it brings the
  // swipe hook with it. The mock has to answer for that too, or the module
  // has no export the dialog can call.
  useSwipeBack: () => ({ bind: () => undefined, swipeProgress: 0, swipeStyles: {} }),
  useSwipeDismiss: () => ({ bind: () => undefined, swipeProgress: 0, swipeStyles: {} }),
}))

/**
 * The title of a page, and what it says underneath.
 *
 * The shell's project switcher already names the project you are in. On a
 * phone the two are stacked, so the name appeared twice within sixty pixels
 * - once in the switcher, once in blue under the title. One place says it.
 */
describe('Header.EditableTitle', () => {
  beforeEach(() => {
    useMobile.mockReturnValue(false)
  })

  it('shows the subtitle on a wide screen', () => {
    render(
      <MemoryRouter>
        <Header>
          <Header.EditableTitle
            value="Morning sync"
            onChange={() => {}}
            subtitle={<span>demo</span>}
            subtitleRepeatsProject
          />
        </Header>
      </MemoryRouter>,
    )

    expect(screen.getByText('Morning sync')).toBeInTheDocument()
    expect(screen.getByText('demo')).toBeInTheDocument()
  })

  it('drops the repeated project name on a phone', () => {
    useMobile.mockReturnValue(true)
    render(
      <MemoryRouter>
        <Header>
          <Header.EditableTitle
            value="Morning sync"
            onChange={() => {}}
            subtitle={<span>demo</span>}
            subtitleRepeatsProject
          />
        </Header>
      </MemoryRouter>,
    )

    expect(screen.getByText('Morning sync')).toBeInTheDocument()
    expect(screen.queryByText('demo')).not.toBeInTheDocument()
  })

  it('keeps a subtitle that is not the project name on a phone', () => {
    // The assistant's label is not a project the switcher can show, so it
    // stays: removing it would leave the screen saying nothing about where
    // the conversation is.
    useMobile.mockReturnValue(true)
    render(
      <MemoryRouter>
        <Header>
          <Header.EditableTitle
            value="Morning sync"
            onChange={() => {}}
            subtitle={<span>Assistant</span>}
          />
        </Header>
      </MemoryRouter>,
    )

    expect(screen.getByText('Assistant')).toBeInTheDocument()
  })
})
