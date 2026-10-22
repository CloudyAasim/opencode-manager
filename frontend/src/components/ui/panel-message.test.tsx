import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { PanelMessage } from './panel-message'

describe('PanelMessage', () => {
  it('图标、标题、细节各就各位', () => {
    render(<PanelMessage icon={<svg data-testid="icon" />} title="Nothing here" detail="no rows" />)

    // The headline has to be readable and the line under it has to step
    // back - that order is the whole point of the component.
    expect(screen.getByText('Nothing here')).toHaveClass('font-medium', 'text-foreground')
    expect(screen.getByText('no rows')).toHaveClass('text-muted-foreground')
    expect(screen.getByTestId('icon').parentElement?.className).toContain('[&>svg]:size-8')
  })

  it('出错时图标是危险色，不是灰的', () => {
    render(<PanelMessage tone="error" icon={<svg data-testid="icon" />} title="Failed" />)

    expect(screen.getByTestId('icon').parentElement?.className).toContain('text-destructive')
  })

  it('紧凑尺寸的图标更小', () => {
    render(<PanelMessage size="sm" icon={<svg data-testid="icon" />} title="Empty" />)

    expect(screen.getByTestId('icon').parentElement?.className).toContain('[&>svg]:size-5')
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

  it('操作按钮和上面的文字之间留有空当', () => {
    render(
      <PanelMessage
        icon={<svg />}
        title="Failed"
        detail="no rows"
        action={<button type="button">Back</button>}
      />,
    )

    // The action used to sit flush against the line above it, with no space
    // at all, which is how a message ends up looking like one paragraph.
    const action = screen.getByRole('button', { name: 'Back' })
    expect(action.parentElement?.className).toContain('mt-4')
  })

  it('外层 class 可以覆盖间距', () => {
    render(<PanelMessage icon={<svg />} title="Empty" className="py-4" />)
    expect(screen.getByText('Empty').parentElement?.className).toContain('py-4')
  })
})
