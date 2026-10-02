import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { PanelMessage } from './panel-message'

describe('PanelMessage', () => {
  it('图标、标题、细节各就各位', () => {
    render(<PanelMessage icon={<svg data-testid="icon" />} title="Nothing here" detail="no rows" />)

    expect(screen.getByText('Nothing here')).toHaveClass('text-sm')
    expect(screen.getByText('no rows')).toHaveClass('text-xs')
    expect(screen.getByTestId('icon').parentElement?.className).toContain('opacity-50')
  })

  it('没有细节和操作时不留空位', () => {
    const { container } = render(<PanelMessage icon={<svg />} title="Empty" />)

    expect(container.querySelectorAll('p')).toHaveLength(1)
    expect(container.querySelector('button')).toBeNull()
  })

  it('可以带一个操作按钮', () => {
    render(
      <PanelMessage
        icon={<svg />}
        title="Failed"
        action={<button type="button">Back</button>}
      />,
    )

    expect(screen.getByRole('button', { name: 'Back' })).toBeInTheDocument()
  })

  it('外层 class 可以覆盖间距', () => {
    render(<PanelMessage icon={<svg />} title="Empty" className="py-4" />)
    expect(screen.getByText('Empty').parentElement?.className).toContain('py-4')
  })
})
