import { describe, it, expect, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { getShortcutAction, useShortcutAction } from './shortcutRegistry'

describe('useShortcutAction', () => {
  it('注册后派发器能拿到，卸载后就没了', () => {
    const run = vi.fn()
    const { unmount } = renderHook(() => useShortcutAction('toggleMode', run))

    act(() => getShortcutAction('toggleMode')?.())
    expect(run).toHaveBeenCalledTimes(1)

    act(() => unmount())
    expect(getShortcutAction('toggleMode')).toBeUndefined()
  })

  it('调用的是最新传入的实现', () => {
    const first = vi.fn()
    const second = vi.fn()
    const { rerender } = renderHook(({ run }) => useShortcutAction('submit', run), {
      initialProps: { run: first },
    })

    rerender({ run: second })
    act(() => getShortcutAction('submit')?.())

    expect(first).not.toHaveBeenCalled()
    expect(second).toHaveBeenCalledTimes(1)
  })

  it('换了动作名会重新注册，不留下旧的那个', () => {
    const { rerender, unmount } = renderHook(
      ({ action }) => useShortcutAction(action, vi.fn()),
      { initialProps: { action: 'submit' as string } },
    )

    expect(getShortcutAction('submit')).toBeDefined()

    rerender({ action: 'toggleMode' })

    expect(getShortcutAction('submit')).toBeUndefined()
    expect(getShortcutAction('toggleMode')).toBeDefined()
    act(() => unmount())
  })

  it('没有注册过的动作拿不到实现', () => {
    expect(getShortcutAction('nothing-registered-here')).toBeUndefined()
  })
})
