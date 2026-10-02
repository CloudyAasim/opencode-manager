import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useKeyboardShortcuts } from './useKeyboardShortcuts'
import { useShortcutAction } from '@/framework/commands/shortcutRegistry'

const { preferencesRef } = vi.hoisted(() => ({ preferencesRef: { current: undefined as unknown } }))

vi.mock('./useSettings', () => ({ useSettings: () => ({ preferences: preferencesRef.current }) }))

const PREFERENCES = {
  leaderKey: 'Ctrl+K',
  directShortcuts: ['submit', 'variantCycle'],
  keyboardShortcuts: {
    submit: 'Ctrl+Return',
    abort: 'Esc',
    compact: 'Ctrl+Shift+C',
    variantCycle: 'Ctrl+T',
  },
}

const NOOP = (): void => {}

function press(init: KeyboardEventInit & { key: string }, target: EventTarget = document) {
  act(() => {
    target.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init }))
  })
}

// The page owns most actions and hands them over; variantCycle is owned by a
// feature, so it arrives through the registry instead - exactly the split
// SessionDetail and PromptInput have.
function render(page: Record<string, (() => void) | undefined> = {}, featureOwned?: () => void) {
  return renderHook(() => {
    useKeyboardShortcuts(page)
    useShortcutAction('variantCycle', featureOwned ?? NOOP)
  })
}

describe('useKeyboardShortcuts', () => {
  beforeEach(() => {
    preferencesRef.current = PREFERENCES
  })

  it('leader 之后按下绑定键会执行对应动作', () => {
    const compact = vi.fn()
    render({ compact })

    press({ key: 'k', ctrlKey: true })
    press({ key: 'c', ctrlKey: true, shiftKey: true })

    expect(compact).toHaveBeenCalledTimes(1)
  })

  it('leader 之后的 Esc 能执行默认归 leader 管的 abort', () => {
    const abort = vi.fn()
    render({ abort })

    press({ key: 'k', ctrlKey: true })
    press({ key: 'Escape' })

    expect(abort).toHaveBeenCalledTimes(1)
  })

  it('页面没实现的动作由 feature 注册的处理器接手', () => {
    const cycle = vi.fn()
    render({}, cycle)

    press({ key: 't', ctrlKey: true })

    expect(cycle).toHaveBeenCalledTimes(1)
  })

  it('页面自己的实现优先于 feature 注册的处理器', () => {
    const page = vi.fn()
    const feature = vi.fn()
    render({ variantCycle: page }, feature)

    press({ key: 't', ctrlKey: true })

    expect(page).toHaveBeenCalledTimes(1)
    expect(feature).not.toHaveBeenCalled()
  })

  it('用户在输入框里打字时只放行直触动作', () => {
    const submit = vi.fn()
    const compact = vi.fn()
    const input = document.createElement('input')
    document.body.appendChild(input)
    render({ submit, compact })

    press({ key: 'Enter', ctrlKey: true }, input)
    expect(submit).toHaveBeenCalledTimes(1)

    press({ key: 'k', ctrlKey: true }, input)
    expect(compact).not.toHaveBeenCalled()

    input.remove()
  })

  it('用户自己标为直触的动作在输入框里也能触发', () => {
    preferencesRef.current = { ...PREFERENCES, directShortcuts: ['submit', 'variantCycle', 'compact'] }
    const compact = vi.fn()
    const input = document.createElement('textarea')
    document.body.appendChild(input)
    render({ compact })

    press({ key: 'c', ctrlKey: true, shiftKey: true }, input)

    expect(compact).toHaveBeenCalledTimes(1)
    input.remove()
  })

  it('没有绑定的组合键不触发任何动作', () => {
    const submit = vi.fn()
    render({ submit })

    press({ key: '9', ctrlKey: true })

    expect(submit).not.toHaveBeenCalled()
  })
})
