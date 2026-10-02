import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SessionPanel, type SessionPanelTab } from './SessionPanel'
import { STORAGE_KEYS } from '@/lib/storage-keys'

// the real label keys the page uses
const LABEL: Record<string, string> = {
  files: 'navigation.files',
  review: 'navigation.sourceControl',
  info: 'navigation.detail',
  terminal: 'navigation.terminal',
}

function tab(id: string): SessionPanelTab {
  return {
    id,
    labelKey: LABEL[id]!,
    icon: () => null,
    render: () => <div>{`body-${id}`}</div>,
  }
}

const TABS = [tab('files'), tab('review'), tab('info'), tab('terminal')]

function panel(overrides: Partial<Parameters<typeof SessionPanel>[0]> = {}) {
  const props = {
    open: true,
    onOpenChange: vi.fn(),
    isDesktop: true,
    width: 420,
    onResizeStart: vi.fn(),
    onResizeTouchStart: vi.fn(),
    onResizeKey: vi.fn(),
    tabs: TABS,
    defaultTabIds: ['files', 'review', 'info'],
    storageKey: STORAGE_KEYS.chatPanelTabs,
    ...overrides,
  }
  render(<SessionPanel {...props} />)
  return props
}

beforeEach(() => {
  window.localStorage.clear()
})

describe('SessionPanel', () => {
  it('renders nothing while closed', () => {
    panel({ open: false })
    expect(screen.queryByText('body-files')).toBeNull()
  })

  it('shows the first default tab', () => {
    panel()
    expect(screen.getByText('body-files')).toBeTruthy()
  })

  it('switches to another tab', async () => {
    const user = userEvent.setup()
    panel()
    // tab labels come from navigation.* : Files, Source Control, Detail, Terminal
    await user.click(screen.getByRole('button', { name: 'Detail' }))
    expect(screen.getByText('body-info')).toBeTruthy()
  })

  it('only offers tabs that are not already open', async () => {
    const user = userEvent.setup()
    panel()
    // navigation.add is "Add panel"; the three defaults are already open
    await user.click(screen.getByRole('button', { name: 'Add panel' }))
    expect(screen.getByRole('menuitem', { name: /Terminal/ })).toBeTruthy()
    expect(screen.queryByRole('menuitem', { name: /Files/ })).toBeNull()
  })

  it('cannot remove the last remaining tab', () => {
    panel({ defaultTabIds: ['files'] })
    expect(screen.queryByRole('button', { name: /remove|移除/i })).toBeNull()
  })

  it('offers the remove control once more than one tab is open', () => {
    panel()
    expect(screen.getAllByRole('button', { name: /remove|移除/i }).length).toBeGreaterThan(0)
  })

  it('asks the owner to close', () => {
    const props = panel()
    fireEvent.click(screen.getAllByRole('button', { name: /close|关闭/i })[0]!)
    expect(props.onOpenChange).toHaveBeenCalledWith(false)
  })

  it('drops a remembered tab that no longer exists', () => {
    window.localStorage.setItem(
      STORAGE_KEYS.chatPanelTabs,
      JSON.stringify(['files', 'removed-feature']),
    )
    panel()
    expect(screen.getByText('body-files')).toBeTruthy()
    expect(screen.queryByText(/removed-feature/)).toBeNull()
  })

  it('remembers the chosen tabs', () => {
    panel()
    expect(window.localStorage.getItem(STORAGE_KEYS.chatPanelTabs)).toBeTruthy()
  })
})
