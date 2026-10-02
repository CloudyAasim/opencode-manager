import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Dialog, DialogContent } from './dialog'
import { DialogLayout } from './dialog-layout'

function renderLayout(ui: React.ReactNode) {
  return render(
    <Dialog open onOpenChange={() => {}}>
      <DialogContent>{ui}</DialogContent>
    </Dialog>,
  )
}

describe('DialogLayout', () => {
  it('标题栏带分隔线，主体占满剩余高度并可滚动', () => {
    renderLayout(
      <DialogLayout title="Edit agent">
        <p>body</p>
      </DialogLayout>,
    )

    const header = screen.getByText('Edit agent').closest('div')
    expect(header?.className).toContain('border-b')

    const body = screen.getByText('body').parentElement
    expect(body?.className).toContain('overflow-y-auto')
    expect(body?.className).toContain('flex-1')
    expect(body?.className).toContain('p-2 sm:p-4')
  })

  it('主体只在传了钩子时才拦事件', () => {
    const onBodyClick = vi.fn()
    const { unmount } = renderLayout(
      <DialogLayout title="A" onBodyClick={onBodyClick}>
        <button type="button">hit</button>
      </DialogLayout>,
    )
    screen.getByRole('button', { name: 'hit' }).click()
    expect(onBodyClick).toHaveBeenCalledTimes(1)
    unmount()
    onBodyClick.mockClear()

    renderLayout(
      <DialogLayout title="A">
        <button type="button">plain</button>
      </DialogLayout>,
    )
    screen.getByRole('button', { name: 'plain' }).click()
    expect(onBodyClick).not.toHaveBeenCalled()
  })
})
