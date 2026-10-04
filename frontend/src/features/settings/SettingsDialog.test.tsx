import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, within, act } from '@testing-library/react'
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom'
import { SettingsDialog } from './SettingsDialog'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { DESKTOP_MEDIA_QUERY } from '@/hooks/useMediaQuery'

vi.mock('@/features/settings/GeneralSettings', () => ({
  GeneralSettings: () => <div data-testid="general-settings">General Settings Content</div>,
}))

vi.mock('@/features/settings/GitSettings', () => ({
  GitSettings: () => <div data-testid="git-settings">Git Settings Content</div>,
}))

vi.mock('@/features/settings/KeyboardShortcuts', () => ({
  KeyboardShortcuts: () => <div data-testid="shortcuts-settings">Keyboard Shortcuts Content</div>,
}))

vi.mock('@/features/settings/OpenCodeConfigManager', () => ({
  OpenCodeConfigManager: () => <div data-testid="opencode-settings">OpenCode Config Content</div>,
}))

vi.mock('@/features/settings/ProviderSettings', () => ({
  ProviderSettings: () => <div data-testid="providers-settings">Provider Settings Content</div>,
}))

vi.mock('@/features/settings/AccountSettings', () => ({
  AccountSettings: () => <div data-testid="account-settings">Account Settings Content</div>,
}))

vi.mock('@/features/settings/VoiceSettings', () => ({
  VoiceSettings: () => <div data-testid="voice-settings">Voice Settings Content</div>,
}))

vi.mock('@/features/settings/NotificationSettings', () => ({
  NotificationSettings: () => <div data-testid="notification-settings">Notification Settings Content</div>,
}))

vi.mock('@/features/settings/VersionSelectDialog', () => ({
  VersionSelectDialog: () => <div data-testid="version-select-dialog">Version Select Dialog</div>,
}))

vi.mock('@/features/settings/LogsViewer', () => ({
  LogsViewer: () => <div data-testid="logs-settings">Logs Content</div>,
}))

vi.mock('@/hooks/useMobile', () => ({
  useSwipeBack: vi.fn(() => ({
    bind: vi.fn(),
    swipeProgress: 0,
    swipeStyles: {},
  })),
}))

// A stub has to put back exactly what it replaced. Deleting window.matchMedia
// in afterEach takes the global with it, which only looks harmless because this
// jsdom ships none - the next one might, and a sibling file relying on the real
// one would break for a reason that has nothing to do with its own test.
let originalMatchMedia: PropertyDescriptor | undefined

function restoreMatchMedia(): void {
  if (originalMatchMedia) {
    Object.defineProperty(window, 'matchMedia', originalMatchMedia)
  } else {
    Reflect.deleteProperty(window, 'matchMedia')
  }
  originalMatchMedia = undefined
}

function stubMatchMedia(matches: boolean): () => void {
  const listeners = new Set<() => void>()
  const mediaQueryList = {
    media: DESKTOP_MEDIA_QUERY,
    matches,
    addEventListener: (_type: string, listener: () => void) => {
      listeners.add(listener)
    },
    removeEventListener: (_type: string, listener: () => void) => {
      listeners.delete(listener)
    },
  }
  originalMatchMedia = Object.getOwnPropertyDescriptor(window, 'matchMedia')
  originalMatchMedia = Object.getOwnPropertyDescriptor(window, 'matchMedia')
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: () => mediaQueryList,
  })
}

describe('SettingsDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    restoreMatchMedia()
  })

  it('resets to menu state when dialog closes and reopens', () => {
    function TestWrapper() {
      const location = useLocation()
      const navigate = useNavigate()

      const searchParams = new URLSearchParams(location.search)
      const isOpen = searchParams.get('settings') === 'open'

      return (
        <>
          <button onClick={() => navigate('?settings=open&settingsTab=general')}>Open Settings</button>
          <button onClick={() => navigate('/')}>Close Settings</button>
          {isOpen && <span data-testid="dialog-open">Dialog Open</span>}
          <SettingsDialog />
        </>
      )
    }

    render(
      <MemoryRouter initialEntries={['/']}>
        <TestWrapper />
      </MemoryRouter>
    )

    fireEvent.click(screen.getByText('Open Settings'))
    expect(screen.getByTestId('dialog-open')).toBeInTheDocument()

    fireEvent.click(screen.getByText('Close Settings'))
    expect(screen.queryByTestId('dialog-open')).not.toBeInTheDocument()

    fireEvent.click(screen.getByText('Open Settings'))
    expect(screen.getByTestId('dialog-open')).toBeInTheDocument()
  })

  it('displays menu items in mobile view', () => {
    function TestWrapper() {
      const location = useLocation()
      const navigate = useNavigate()

      const searchParams = new URLSearchParams(location.search)
      const isOpen = searchParams.get('settings') === 'open'

      return (
        <>
          <button onClick={() => navigate('?settings=open')}>Open Settings</button>
          {isOpen && <span data-testid="dialog-open">Dialog Open</span>}
          <SettingsDialog />
        </>
      )
    }

    render(
      <MemoryRouter initialEntries={['/']}>
        <TestWrapper />
      </MemoryRouter>
    )

    fireEvent.click(screen.getByText('Open Settings'))
    expect(screen.getByTestId('dialog-open')).toBeInTheDocument()

    expect(screen.getAllByText('Account').length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText('General Settings').length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText('Git').length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText('Keyboard Shortcuts').length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText('OpenCode Config').length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText('Providers').length).toBeGreaterThanOrEqual(1)

    const mobileContainer = document.querySelector('.sm\\:hidden') as HTMLElement
    const mobile = within(mobileContainer)
    expect(mobile.getByRole('heading', { name: 'Settings' })).toBeInTheDocument()
    expect(mobileContainer.querySelector('svg.lucide-chevron-left')).toBeNull()
    expect(mobile.queryByTestId('logs-settings')).not.toBeInTheDocument()
  })

  it('navigates to the Logs section and reflects settingsTab=logs in the URL', () => {
    function TestWrapper() {
      const location = useLocation()
      const navigate = useNavigate()

      const searchParams = new URLSearchParams(location.search)
      const isOpen = searchParams.get('settings') === 'open'

      return (
        <>
          <button onClick={() => navigate('?settings=open')}>Open Settings</button>
          {isOpen && <span data-testid="dialog-open">Dialog Open</span>}
          {isOpen && <span data-testid="location-search">{location.search}</span>}
          <SettingsDialog />
        </>
      )
    }

    render(
      <MemoryRouter initialEntries={['/']}>
        <TestWrapper />
      </MemoryRouter>
    )

    fireEvent.click(screen.getByText('Open Settings'))

    const logsMenuButton = screen.getByText('Live manager and OpenCode server logs').closest('button')
    expect(logsMenuButton).not.toBeNull()
    fireEvent.click(logsMenuButton!)

    const mobileContainer = document.querySelector('.sm\\:hidden') as HTMLElement
    expect(within(mobileContainer).getByTestId('logs-settings')).toBeInTheDocument()
    expect(screen.getByTestId('location-search')).toHaveTextContent('settingsTab=logs')
  })

  it('starts at the menu on mobile even with a deep-linked settingsTab and navigates from there', () => {
    stubMatchMedia(false)
    function TestWrapper() {
      const location = useLocation()
      const navigate = useNavigate()

      const searchParams = new URLSearchParams(location.search)
      const isOpen = searchParams.get('settings') === 'open'

      return (
        <>
          <button onClick={() => navigate('/')}>Close Settings</button>
          {isOpen && <span data-testid="dialog-open">Dialog Open</span>}
          {isOpen && <span data-testid="location-search">{location.search}</span>}
          <SettingsDialog />
        </>
      )
    }

    render(
      <MemoryRouter initialEntries={['/?settings=open&settingsTab=logs']}>
        <TestWrapper />
      </MemoryRouter>
    )

    expect(screen.getByTestId('dialog-open')).toBeInTheDocument()

    const mobileContainer = document.querySelector('.sm\\:hidden') as HTMLElement
    const mobile = within(mobileContainer)

    expect(mobile.getByRole('heading', { name: 'Settings' })).toBeInTheDocument()
    expect(mobile.getByText('Live manager and OpenCode server logs')).toBeInTheDocument()
    expect(mobile.queryByTestId('logs-settings')).not.toBeInTheDocument()
    expect(mobileContainer.querySelector('svg.lucide-chevron-left')).toBeNull()
    expect(screen.queryByTestId('logs-settings')).not.toBeInTheDocument()

    const logsMenuButton = mobile.getByText('Live manager and OpenCode server logs').closest('button')
    expect(logsMenuButton).not.toBeNull()
    fireEvent.click(logsMenuButton!)

    expect(mobile.getByTestId('logs-settings')).toBeInTheDocument()
    expect(mobile.getByRole('heading', { name: 'Logs' })).toBeInTheDocument()
    expect(screen.getAllByTestId('logs-settings')).toHaveLength(1)
    expect(screen.getByTestId('location-search')).toHaveTextContent('settingsTab=logs')

    const backButton = mobileContainer.querySelector('svg.lucide-chevron-left')?.closest('button')
    expect(backButton).not.toBeNull()
    fireEvent.click(backButton!)

    expect(mobile.queryByTestId('logs-settings')).not.toBeInTheDocument()
    expect(mobile.getByRole('heading', { name: 'Settings' })).toBeInTheDocument()
    expect(mobileContainer.querySelector('svg.lucide-chevron-left')).toBeNull()
  })

  it('mounts exactly one LogsViewer on desktop when the Logs tab is selected', () => {
    stubMatchMedia(true)
    function TestWrapper() {
      const location = useLocation()
      const navigate = useNavigate()

      const searchParams = new URLSearchParams(location.search)
      const isOpen = searchParams.get('settings') === 'open'

      return (
        <>
          <button onClick={() => navigate('?settings=open&settingsTab=logs')}>Open Logs</button>
          {isOpen && <span data-testid="dialog-open">Dialog Open</span>}
          <SettingsDialog />
        </>
      )
    }

    render(
      <MemoryRouter initialEntries={['/']}>
        <TestWrapper />
      </MemoryRouter>
    )

    fireEvent.click(screen.getByText('Open Logs'))

    expect(screen.getAllByTestId('logs-settings')).toHaveLength(1)
    const mobileContainer = document.querySelector('.sm\\:hidden') as HTMLElement
    expect(within(mobileContainer).queryByTestId('logs-settings')).not.toBeInTheDocument()
    expect(within(mobileContainer).getByRole('heading', { name: 'Logs' })).toBeInTheDocument()
  })

  it('falls back to the menu and account tab for an unknown settingsTab value', () => {
    function TestWrapper() {
      const location = useLocation()
      const isOpen = new URLSearchParams(location.search).get('settings') === 'open'
      return (
        <>
          {isOpen && <span data-testid="dialog-open">Dialog Open</span>}
          <SettingsDialog />
        </>
      )
    }

    render(
      <MemoryRouter initialEntries={['/?settings=open&settingsTab=log']}>
        <TestWrapper />
      </MemoryRouter>
    )

    expect(screen.getByTestId('dialog-open')).toBeInTheDocument()

    const mobileContainer = document.querySelector('.sm\\:hidden') as HTMLElement
    const mobile = within(mobileContainer)
    expect(mobile.getByRole('heading', { name: 'Settings' })).toBeInTheDocument()
    expect(mobile.getByText('Live manager and OpenCode server logs')).toBeInTheDocument()
    expect(mobile.queryByTestId('logs-settings')).not.toBeInTheDocument()
    expect(mobileContainer.querySelector('svg.lucide-chevron-left')).toBeNull()

    const desktopTrigger = screen.getByRole('tab', { name: 'Account' })
    expect(desktopTrigger).toHaveAttribute('data-state', 'active')
  })

  it('renders a vertical desktop sidebar driven by menu items with URL and keyboard navigation', async () => {
    stubMatchMedia(true)
    function TestWrapper() {
      const location = useLocation()
      return (
        <>
          <span data-testid="location-search">{location.search}</span>
          <SettingsDialog />
        </>
      )
    }

    render(
      <MemoryRouter initialEntries={['/?settings=open']}>
        <TestWrapper />
      </MemoryRouter>
    )

    const tablist = screen.getByRole('tablist')
    expect(tablist).toHaveAttribute('aria-orientation', 'vertical')

    const triggers = screen.getAllByRole('tab')
    expect(triggers).toHaveLength(10)
    const expected = ['Account', 'General Settings', 'Notifications', 'Voice', 'Git', 'Keyboard Shortcuts', 'OpenCode Config', 'Assistant Workspace', 'Logs', 'Providers']
    expect(triggers.map((trigger) => trigger.textContent)).toEqual(expected)

    const logsTrigger = screen.getByRole('tab', { name: 'Logs' })
    fireEvent.mouseDown(logsTrigger)
    expect(screen.getByTestId('location-search')).toHaveTextContent('settingsTab=logs')

    const gitTrigger = screen.getByRole('tab', { name: 'Git' })
    act(() => {
      gitTrigger.focus()
    })
    fireEvent.keyDown(gitTrigger, { key: 'ArrowDown' })
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    expect(screen.getByRole('tab', { name: 'Keyboard Shortcuts' })).toHaveFocus()
  })

  it('keeps Settings open when Escape fires inside a nested dialog', () => {
    function TestWrapper() {
      const location = useLocation()
      const settingsOpen = new URLSearchParams(location.search).get('settings') === 'open'
      return (
        <>
          {settingsOpen && <span data-testid="settings-open" />}
          <SettingsDialog />
          <Dialog open>
            <DialogContent data-testid="nested-dialog">
              <DialogTitle className="sr-only">Nested</DialogTitle>
              <textarea data-testid="nested-input" />
            </DialogContent>
          </Dialog>
        </>
      )
    }

    render(
      <MemoryRouter initialEntries={['/?settings=open']}>
        <TestWrapper />
      </MemoryRouter>,
    )

    expect(screen.getByTestId('settings-open')).toBeInTheDocument()

    const nestedInput = screen.getByTestId('nested-input')
    nestedInput.focus()
    fireEvent.keyDown(nestedInput, { key: 'Escape' })

    expect(screen.getByTestId('settings-open')).toBeInTheDocument()
  })

  it('renders the page variant without a close button', () => {
    render(
      <MemoryRouter>
        <SettingsDialog variant="page" />
      </MemoryRouter>,
    )

    expect(screen.getByRole('tab', { name: 'Account' })).toBeInTheDocument()
    expect(screen.queryByLabelText('Close')).not.toBeInTheDocument()
  })

  it('keeps the close button for the overlay dialog variant', () => {
    render(
      <MemoryRouter initialEntries={['/?settings=open']}>
        <SettingsDialog />
      </MemoryRouter>,
    )

    expect(screen.getAllByLabelText('Close').length).toBeGreaterThan(0)
  })

  it('桌面标签和移动端菜单来自同一份清单', () => {
    stubMatchMedia(true)
    render(
      <MemoryRouter initialEntries={['/?settings=open']}>
        <SettingsDialog />
      </MemoryRouter>
    )

    // Labels are read back off the rendered tabs, so this does not depend on
    // any wording. What it pins is the thing the old duplication broke: the two
    // views used to enumerate the panels separately, and drifting apart meant
    // a setting quietly stopped appearing on one of them.
    const tabLabels = within(screen.getByRole('tablist'))
      .getAllByRole('tab')
      .map((tab) => (tab.textContent ?? '').trim())
    expect(tabLabels.length).toBeGreaterThan(5)

    const mobileContainer = document.querySelector('.sm\\:hidden') as HTMLElement
    const labelOf = (button: HTMLElement) =>
      tabLabels.find((label) => (button.textContent ?? '').trim().startsWith(label))

    const menuOrder = within(mobileContainer)
      .getAllByRole('button')
      .map((button) => labelOf(button as HTMLElement))
      .filter((label): label is string => label !== undefined)

    expect(menuOrder).toEqual(tabLabels)
  })
})
