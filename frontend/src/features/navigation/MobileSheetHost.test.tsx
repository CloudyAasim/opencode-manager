import { vi } from 'vitest'

vi.mock('@/hooks/useMobile')
vi.mock('@/hooks/useMobileSheets', () => ({
  useMobileSheets: vi.fn(),
}))
vi.mock('@/features/navigation/MoreDrawer', () => ({
  MoreDrawer: ({ isOpen }: { isOpen: boolean }) =>
    isOpen ? <div data-testid="more-drawer">MoreDrawer</div> : null,
}))

import { render, screen } from '@testing-library/react'
import { describe, it, expect, beforeEach } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { MobileSheetHost } from './MobileSheetHost'
import { useMobile } from '@/hooks/useMobile'
import { useMobileSheets } from '@/hooks/useMobileSheets'

describe('MobileSheetHost', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(useMobile).mockReturnValue(true)
    vi.mocked(useMobileSheets).mockReturnValue({
      openSheet: null,
      open: vi.fn(),
      close: vi.fn(),
    })
  })

  it('renders nothing when useMobile returns false', () => {
    vi.mocked(useMobile).mockReturnValue(false)
    const { container } = render(
      <MemoryRouter>
        <MobileSheetHost />
      </MemoryRouter>,
    )
    expect(container.firstChild).toBeNull()
  })

  it('renders nothing when no mobileTab param is present', () => {
    const { container } = render(
      <MemoryRouter initialEntries={['/']}>
        <MobileSheetHost />
      </MemoryRouter>,
    )
    expect(container.firstChild).toBeNull()
  })

  /**
   * The repo switcher, the workspace file browser and the notifications sheet
   * were mounted here for keys that no button in the app ever set. They are
   * gone; this pins that a stale link naming one renders nothing rather than
   * silently opening a screen the user can no longer reach any other way.
   */
  it.each(['repos', 'files', 'notifications'])(
    'renders nothing for the removed sheet key %s',
    async (key) => {
      const { container } = render(
        <MemoryRouter initialEntries={[`/?mobileTab=${key}`]}>
          <MobileSheetHost />
        </MemoryRouter>,
      )
      expect(container.firstChild).toBeNull()
    },
  )

  it('renders MoreDrawer when mobileTab=more', async () => {
    vi.mocked(useMobileSheets).mockReturnValue({
      openSheet: 'more',
      open: vi.fn(),
      close: vi.fn(),
    })
    render(
      <MemoryRouter initialEntries={['/?mobileTab=more']}>
        <MobileSheetHost />
      </MemoryRouter>,
    )
    expect(await screen.findByTestId('more-drawer')).toBeInTheDocument()
  })

  it('closes the drawer when onClose is called', async () => {
    const mockClose = vi.fn()
    vi.mocked(useMobileSheets).mockReturnValue({
      openSheet: 'more',
      open: vi.fn(),
      close: mockClose,
    })
    render(
      <MemoryRouter initialEntries={['/?mobileTab=more']}>
        <MobileSheetHost />
      </MemoryRouter>,
    )
    expect(await screen.findByTestId('more-drawer')).toBeInTheDocument()
  })
})
