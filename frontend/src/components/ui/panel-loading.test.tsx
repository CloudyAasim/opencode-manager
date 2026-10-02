import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { PanelLoading } from './panel-loading'

describe('PanelLoading', () => {
  it('默认是整面板尺寸', () => {
    render(<PanelLoading />)
    const status = screen.getByRole('status')
    expect(status).toBeInTheDocument()
    expect(status.querySelector('svg')?.getAttribute('class')).toContain('h-8 w-8')
  })

  it('两个具名尺寸对应列表内和标签内', () => {
    const { unmount } = render(<PanelLoading size="md" />)
    expect(screen.getByRole('status').querySelector('svg')?.getAttribute('class')).toContain('h-6 w-6')
    unmount()

    render(<PanelLoading size="sm" />)
    expect(screen.getByRole('status').querySelector('svg')?.getAttribute('class')).toContain('w-5 h-5')
  })

  it('带可读名字，动画不是静默的', () => {
    render(<PanelLoading />)
    expect(screen.getByRole('status')).toHaveAccessibleName('Loading…')
  })

  it('外层 class 可以覆盖间距', () => {
    render(<PanelLoading className="py-4" />)
    const status = screen.getByRole('status')
    expect(status.className).toContain('py-4')
  })
})
