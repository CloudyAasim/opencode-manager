import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { TerminalSquare } from 'lucide-react'
import { Header } from './header'

const useMobile = vi.fn(() => false)

/**
 * The one size class on an element.
 *
 * A colour class is not a size: `text-foreground` says what colour the text
 * is, not how big it is. So the size is looked for by name.
 */
const sizeOf = (element: Element): string | undefined =>
  element.className
    .split(/\s+/)
    .find((token) => /^text-(2xs|xs|sm|base|lg|xl|[2-9]xl)$/.test(token))

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

  it('is the page heading', () => {
    // The name of the page, and the one thing on the screen that says what
    // the page is.
    render(
      <MemoryRouter>
        <Header>
          <Header.EditableTitle value="Morning sync" onChange={() => {}} />
        </Header>
      </MemoryRouter>,
    )

    expect(screen.getByRole('heading', { level: 1, name: 'Morning sync' })).toBeInTheDocument()
  })
})

/**
 * Two ways of saying the same name.
 *
 * The plain title and the one that can be renamed are the same thing - the
 * name of a page - so they are the same size. They were not: 20px and 16px,
 * which left the session page's name a size smaller than every other page's.
 */
describe('the two titles', () => {
  beforeEach(() => {
    useMobile.mockReturnValue(false)
  })

  it('are the same size', () => {
    render(
      <MemoryRouter>
        <Header>
          <Header.Title>Terminal</Header.Title>
          <Header.EditableTitle value="Morning sync" onChange={() => {}} />
        </Header>
      </MemoryRouter>,
    )

    const plain = screen.getByRole('heading', { level: 1, name: 'Terminal' })
    const editable = screen.getByRole('heading', { level: 1, name: 'Morning sync' })

    expect(
      sizeOf(editable),
      'the title that can be renamed is not the size of the one that cannot',
    ).toBe(sizeOf(plain))
  })

  it('keep their size while the name is being changed', () => {
    // The editor takes the place of the title it replaces. A different size
    // there would make the name jump the moment you start renaming it.
    render(
      <MemoryRouter>
        <Header>
          <Header.EditableTitle value="Morning sync" onChange={() => {}} />
        </Header>
      </MemoryRouter>,
    )

    const title = screen.getByRole('heading', { level: 1, name: 'Morning sync' })
    const size = sizeOf(title)
    fireEvent.click(title)

    expect(
      sizeOf(screen.getByRole('textbox')),
      'the editor is a different size from the title it replaces',
    ).toBe(size)
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
