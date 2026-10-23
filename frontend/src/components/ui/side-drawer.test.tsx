import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { SideDrawer, SideDrawerHeader, SideDrawerContent } from './side-drawer'

describe('SideDrawer', () => {
  it('renders when isOpen is true', () => {
    render(
      <SideDrawer isOpen onClose={() => {}} ariaLabel="Test drawer">
        <div>Test content</div>
      </SideDrawer>,
    )
    expect(screen.getByText('Test content')).toBeInTheDocument()
  })

  it('does not render when isOpen is false', async () => {
    const { container } = render(
      <SideDrawer isOpen={false} onClose={() => {}} ariaLabel="Test drawer">
        <div>Test content</div>
      </SideDrawer>,
    )
    await waitFor(() => {
      expect(container.querySelector('[role="dialog"]')).not.toBeInTheDocument()
    })
  })

  it('calls onClose when backdrop is clicked', () => {
    const handleClose = vi.fn()
    render(
      <SideDrawer isOpen onClose={handleClose} ariaLabel="Test drawer">
        <div>Test content</div>
      </SideDrawer>,
    )
    const backdrop = document.querySelector('.bg-black\\/40')
    if (backdrop) {
      fireEvent.click(backdrop)
    }
    expect(handleClose).toHaveBeenCalled()
  })

  it('calls onClose when Escape key is pressed', () => {
    const handleClose = vi.fn()
    render(
      <SideDrawer isOpen onClose={handleClose} ariaLabel="Test drawer">
        <div>Test content</div>
      </SideDrawer>,
    )
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(handleClose).toHaveBeenCalled()
  })

  it('浮起来：离边留出沟槽，有圆角和影子', () => {
    // The phone's face of the same floating panel the desktop floats. A
    // drawer painted to the edge of the screen with a square corner is the
    // interface from before the geometry arrived.
    render(
      <SideDrawer isOpen onClose={() => {}} ariaLabel="Test drawer">
        <div>Test content</div>
      </SideDrawer>,
    )
    const panel = document.querySelector('[role="dialog"]')!

    expect(panel.className).toContain('rounded-xl')
    expect(panel.className).toContain('shadow-lg')
    expect(panel.className).toContain('bg-surface-glass')
    // Not painted to the edge: the panel clears it on every side.
    expect(panel.className).not.toMatch(/(^|\s)(inset-0|inset-x-0|inset-y-0|top-0|bottom-0|left-0|right-0)(\s|$)/)
    expect(panel.className).toContain('right-3')
  })

})

describe('SideDrawerHeader', () => {
  it('renders with title and close button', () => {
    const handleClose = vi.fn()
    render(
      <SideDrawerHeader title="Test Title" onClose={handleClose} />,
    )
    expect(screen.getByText('Test Title')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /close/i })).toBeInTheDocument()
  })

  it('calls onClose when close button is clicked', () => {
    const handleClose = vi.fn()
    render(
      <SideDrawerHeader title="Test Title" onClose={handleClose} />,
    )
    fireEvent.click(screen.getByRole('button', { name: /close/i }))
    expect(handleClose).toHaveBeenCalled()
  })
})

describe('SideDrawerContent', () => {
  it('renders children with default padding', () => {
    render(
      <SideDrawerContent>
        <div>Content</div>
      </SideDrawerContent>,
    )
    expect(screen.getByText('Content')).toBeInTheDocument()
  })
})
