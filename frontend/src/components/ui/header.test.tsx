import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { TerminalSquare } from 'lucide-react'
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
describe('Header.EditableTitle', () => {  beforeEach(() => {
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

/**
 * The title of a page: a name, a mark in front of it, and a line under it.
 *
 * The terminal page needed all three - an icon, the page's name, and a line
 * saying what the page is - and it had to go and draw them by hand, because
 * the shared title bar could only hold a name. The three belong to the title
 * bar, so the title bar takes them.
 */
describe('Header.Title', () => {
  it('is the page heading', () => {
    render(
      <MemoryRouter>
        <Header>
          <Header.Title>Terminal</Header.Title>
        </Header>
      </MemoryRouter>,
    )

    expect(screen.getByRole('heading', { level: 1, name: 'Terminal' })).toBeInTheDocument()
  })

  it('takes a mark in front of the name', () => {
    render(
      <MemoryRouter>
        <Header>
          <Header.Title icon={<TerminalSquare data-testid="mark" />}>Terminal</Header.Title>
        </Header>
      </MemoryRouter>,
    )

    expect(screen.getByTestId('mark')).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 1, name: 'Terminal' })).toBeInTheDocument()
  })

  it('takes a line under the name', () => {
    render(
      <MemoryRouter>
        <Header>
          <Header.Title description="A shell scoped to your own workspace">Terminal</Header.Title>
        </Header>
      </MemoryRouter>,
    )

    expect(screen.getByText('A shell scoped to your own workspace')).toBeInTheDocument()
  })

  it('says nothing more than the name when given nothing more', () => {
    const { container } = render(
      <MemoryRouter>
        <Header>
          <Header.Title>Terminal</Header.Title>
        </Header>
      </MemoryRouter>,
    )

    expect(container.querySelectorAll('p')).toHaveLength(0)
  })
})
