import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { Switch } from './switch'

/**
 * The switch is the control people set things with, so it is the one that
 * has to look like it belongs to the same system as everything else. These
 * are the parts of it that were a decision rather than an accident: the
 * geometry, the colour, and the fact that it says what it is to a screen
 * reader.
 */

describe('Switch', () => {
  it('is a switch to assistive technology', () => {
    render(<Switch checked={false} onCheckedChange={() => {}} aria-label="通知" />)
    const control = screen.getByRole('switch', { name: '通知' })
    expect(control).toHaveAttribute('aria-checked', 'false')
  })

  it('reports the state it was given', () => {
    render(<Switch checked onCheckedChange={() => {}} aria-label="通知" />)
    expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'true')
  })

  it('reports the new state when it is clicked', () => {
    const onCheckedChange = vi.fn()
    render(<Switch checked={false} onCheckedChange={onCheckedChange} aria-label="通知" />)
    fireEvent.click(screen.getByRole('switch'))
    expect(onCheckedChange).toHaveBeenCalledWith(true)
  })

  it('uses the scheme, not a traffic light', () => {
    const { container } = render(<Switch checked onCheckedChange={() => {}} />)
    const root = container.querySelector('[data-slot="switch"]')!
    const classes = root.getAttribute('class')!

    expect(classes).toContain('data-[state=checked]:bg-primary')
    expect(classes).toContain('data-[state=unchecked]:bg-muted')
    expect(classes).not.toMatch(/\b(?:bg|text|border)-(?:green|gray|grey)-/)
  })

  it('has a knob in the scheme\'s paper white', () => {
    const { container } = render(<Switch checked onCheckedChange={() => {}} />)
    const thumb = container.querySelector('[data-slot="switch-thumb"]')!
    expect(thumb.getAttribute('class')).toContain('bg-switch-thumb')
  })

  it('is sized so the knob lands on the border', () => {
    const { container } = render(<Switch checked onCheckedChange={() => {}} />)
    const root = container.querySelector('[data-slot="switch"]')!
    const thumb = container.querySelector('[data-slot="switch-thumb"]')!

    // A 44x24 track with a 1px border and 1px padding leaves a 40x20
    // content box, and the 20px knob fills it exactly - off at 2..22, on at
    // 22..42. A knob that does not land on the border is a knob the eye
    // reads as misaligned.
    expect(root.getAttribute('class')).toContain('h-6')
    expect(root.getAttribute('class')).toContain('w-11')
    expect(root.getAttribute('class')).toContain('p-px')

    const thumbClasses = thumb.getAttribute('class')!
    expect(thumbClasses).toContain('size-5')
    expect(thumbClasses).toContain('data-[state=checked]:translate-x-5')
    expect(thumbClasses).toContain('data-[state=unchecked]:translate-x-0')
  })
})
