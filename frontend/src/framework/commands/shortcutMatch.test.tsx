import { describe, it, expect, vi } from 'vitest'
import { render, fireEvent, act } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { CommandProvider } from '@/framework/commands/CommandProvider'
import { useRegisterCommands } from '@/framework/commands/commandRegistry'
import { LayerProvider } from '@/framework/layer/LayerProvider'
import { matchesShortcut, matchesUserShortcut, normalizeShortcut, parseEventShortcut } from './shortcutMatch'
import type { AppCommand } from './types'

function keyEvent(init: KeyboardEventInit) {
  return new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init })
}

describe('shortcut matching', () => {
  it('reads modifiers in a stable order', () => {
    const event = keyEvent({ key: 'k', metaKey: true, shiftKey: true })
    expect(parseEventShortcut(event)).toBe('Cmd+Shift+K')
  })

  it('ignores a bare modifier press', () => {
    expect(parseEventShortcut(keyEvent({ key: 'Meta', metaKey: true }))).toBe('')
  })

  it('normalises the named keys users type', () => {
    expect(parseEventShortcut(keyEvent({ key: 'Escape' }))).toBe('Esc')
    expect(parseEventShortcut(keyEvent({ key: 'ArrowUp' }))).toBe('Up')
    expect(parseEventShortcut(keyEvent({ key: 'Enter' }))).toBe('Return')
    expect(parseEventShortcut(keyEvent({ key: ' ' }))).toBe('Space')
  })

  it('uppercases a single character so bindings are case independent', () => {
    expect(parseEventShortcut(keyEvent({ key: 'k', ctrlKey: true }))).toBe('Ctrl+K')
  })

  it('normalise maps Cmd onto the platform modifier for user bindings', () => {
    const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0
    expect(normalizeShortcut('Cmd+K')).toBe(isMac ? 'Cmd+K' : 'Ctrl+K')
  })

  it('matches a declared combination literally', () => {
    expect(matchesShortcut(keyEvent({ key: 'k', metaKey: true }), 'Cmd+K')).toBe(true)
    expect(matchesShortcut(keyEvent({ key: 'k', ctrlKey: true }), 'Ctrl+K')).toBe(true)
    expect(matchesShortcut(keyEvent({ key: 'j', metaKey: true }), 'Cmd+K')).toBe(false)
    expect(matchesShortcut(keyEvent({ key: 'k', metaKey: true, shiftKey: true }), 'Cmd+K')).toBe(false)
  })

  it('normalises only on the user-binding path', () => {
    const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0
    const event = isMac ? keyEvent({ key: 'k', metaKey: true }) : keyEvent({ key: 'k', ctrlKey: true })
    expect(matchesUserShortcut(event, 'Cmd+K')).toBe(true)
  })
})

function Harness({ commands }: { commands: AppCommand[] }) {
  useRegisterCommands(commands)
  return null
}

function renderCommands(commands: AppCommand[]) {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <LayerProvider>
        <CommandProvider>
          <Harness commands={commands} />
        </CommandProvider>
      </LayerProvider>
    </MemoryRouter>,
  )
}

describe('command shortcuts', () => {
  it('runs a command from its declared shortcut', () => {
    const run = vi.fn()
    const commands: AppCommand[] = [
      { id: 'x.one', group: 'test', label: 'One', labelKey: 'common.ok', shortcut: 'Alt+1', run },
    ]
    renderCommands(commands)

    act(() => {
      fireEvent(window, keyEvent({ key: '1', altKey: true }))
    })

    expect(run).toHaveBeenCalledTimes(1)
  })

  it('leaves an unbound key alone', () => {
    const run = vi.fn()
    renderCommands([{ id: 'x.one', group: 'test', label: 'One', labelKey: 'common.ok', shortcut: 'Alt+1', run }])

    act(() => {
      fireEvent(window, keyEvent({ key: '2', altKey: true }))
    })

    expect(run).not.toHaveBeenCalled()
  })

  it.each([
    ['Cmd', { key: 'k', metaKey: true }],
    ['Ctrl', { key: 'k', ctrlKey: true }],
  ])('still opens the palette on %s+K', (_label, init) => {
    renderCommands([])

    const event = keyEvent(init as KeyboardEventInit)
    act(() => {
      window.dispatchEvent(event)
    })

    expect(event.defaultPrevented).toBe(true)
  })

  it('unregisters its shortcut when the command goes away', () => {
    const first = vi.fn()
    const second = vi.fn()
    const { rerender } = renderCommands([
      { id: 'x.one', group: 'test', label: 'One', labelKey: 'common.ok', shortcut: 'Alt+1', run: first },
    ])

    act(() => {
      fireEvent(window, keyEvent({ key: '1', altKey: true }))
    })
    expect(first).toHaveBeenCalledTimes(1)

    rerender(
      <MemoryRouter initialEntries={['/']}>
        <LayerProvider>
          <CommandProvider>
            <Harness commands={[{ id: 'x.two', group: 'test', label: 'Two', labelKey: 'common.ok', shortcut: 'Alt+2', run: second }]} />
          </CommandProvider>
        </LayerProvider>
      </MemoryRouter>,
    )

    act(() => {
      fireEvent(window, keyEvent({ key: '1', altKey: true }))
    })
    expect(first).toHaveBeenCalledTimes(1)

    act(() => {
      fireEvent(window, keyEvent({ key: '2', altKey: true }))
    })
    expect(second).toHaveBeenCalledTimes(1)
  })
})
