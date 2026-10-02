import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import {
  percentOfContainer,
  pixelDelta,
  pixelDeltaInverted,
  useDragResize,
} from './useDragResize'

function mouse(clientX: number) {
  return new MouseEvent('mousemove', { bubbles: true, cancelable: true, clientX })
}

function touchAt(clientX: number) {
  const event = new Event('touchmove', { bubbles: true, cancelable: true }) as unknown as {
    touches: Array<{ clientX: number }>
    preventDefault: () => void
  }
  event.touches = [{ clientX }]
  return event
}

describe('useDragResize', () => {
  beforeEach(() => {
    document.body.style.userSelect = ''
    document.body.style.cursor = ''
  })

  afterEach(() => vi.clearAllMocks())

  it('鼠标拖动按像素增量改变值', () => {
    let value = 100
    const setValue = vi.fn((next: number) => {
      value = next
    })
    const { result } = renderHook(() =>
      useDragResize({ getValue: () => value, setValue, toValue: pixelDelta }),
    )

    act(() => result.current.onMouseDown({ clientX: 200, preventDefault: () => {} } as never))
    act(() => {
      window.dispatchEvent(mouse(240))
    })

    expect(setValue).toHaveBeenLastCalledWith(140)
  })

  it('拖动过程中锁住选中与光标，松手后恢复', () => {
    const { result } = renderHook(() =>
      useDragResize({ getValue: () => 0, setValue: vi.fn(), toValue: pixelDelta }),
    )

    act(() => result.current.onMouseDown({ clientX: 10, preventDefault: () => {} } as never))
    expect(document.body.style.userSelect).toBe('none')
    expect(document.body.style.cursor).toBe('col-resize')
    expect(result.current.dragging).toBe(true)

    act(() => {
      window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
    })
    expect(document.body.style.userSelect).toBe('')
    expect(document.body.style.cursor).toBe('')
    expect(result.current.dragging).toBe(false)
  })

  it('松手之后不再响应移动', () => {
    const setValue = vi.fn()
    const { result } = renderHook(() =>
      useDragResize({ getValue: () => 0, setValue, toValue: pixelDelta }),
    )

    act(() => result.current.onMouseDown({ clientX: 0, preventDefault: () => {} } as never))
    act(() => {
      window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
    })
    act(() => {
      window.dispatchEvent(mouse(500))
    })

    expect(setValue).not.toHaveBeenCalled()
  })

  it('触摸拖动和鼠标拖动走同一条路', () => {
    const setValue = vi.fn()
    const { result } = renderHook(() =>
      useDragResize({ getValue: () => 50, setValue, toValue: pixelDelta }),
    )

    act(() => result.current.onTouchStart({ touches: [{ clientX: 300 }], preventDefault: () => {} } as never))
    act(() => {
      window.dispatchEvent(touchAt(330) as never)
    })

    expect(setValue).toHaveBeenLastCalledWith(80)
  })

  it('组件卸载时解除监听，不把 body 永久锁住', () => {
    const { result, unmount } = renderHook(() =>
      useDragResize({ getValue: () => 0, setValue: vi.fn(), toValue: pixelDelta }),
    )

    act(() => result.current.onMouseDown({ clientX: 0, preventDefault: () => {} } as never))
    expect(document.body.style.userSelect).toBe('none')

    unmount()

    expect(document.body.style.userSelect).toBe('')
    expect(document.body.style.cursor).toBe('')
  })

  it('容器百分比按拖动开始时量到的宽度算', () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    container.getBoundingClientRect = () =>
      ({ left: 100, width: 400 }) as DOMRect

    const ref = { current: container }
    let value = 50
    const setValue = vi.fn((next: number) => {
      value = next
    })
    const { result } = renderHook(() =>
      useDragResize({ containerRef: ref, getValue: () => value, setValue, toValue: percentOfContainer }),
    )

    act(() => result.current.onMouseDown({ clientX: 300, preventDefault: () => {} } as never))
    act(() => {
      window.dispatchEvent(mouse(500))
    })

    expect(setValue).toHaveBeenLastCalledWith(100)
    container.remove()
  })
})

describe('拖动策略', () => {
  const rect = { left: 100, width: 400 } as DOMRect

  it('percentOfContainer 用 clientX 相对容器左边界的比例', () => {
    expect(percentOfContainer(300, { clientX: 100, value: 0, rect })).toBe(50)
  })

  it('容器宽度为 0 时保持原值', () => {
    const zero = { left: 0, width: 0 } as DOMRect
    expect(percentOfContainer(300, { clientX: 0, value: 42, rect: zero })).toBe(42)
  })

  it('没有容器时保持原值', () => {
    expect(percentOfContainer(300, { clientX: 0, value: 42, rect: null })).toBe(42)
  })

  it('pixelDelta 向右拖变大，像素差反向的那个向右拖变小', () => {
    const start = { clientX: 100, value: 300, rect: null }
    expect(pixelDelta(150, start)).toBe(350)
    expect(pixelDeltaInverted(150, start)).toBe(250)
  })
})
