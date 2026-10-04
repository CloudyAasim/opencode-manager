import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { SessionRail } from './SessionRail'
import { STORAGE_KEYS } from '@/lib/storage-keys'
import { SESSION_RAIL_WIDTH_DEFAULT } from '@/lib/repo-constants'

let desktop = true
vi.mock('@/hooks/useDesktop', () => ({ useDesktop: () => desktop }))

beforeEach(() => {
  window.localStorage.clear()
  desktop = true
})

function rail(props: Partial<Parameters<typeof SessionRail>[0]> = {}) {
  render(
    <SessionRail open onClose={vi.fn()} {...props}>
      <p>the list</p>
    </SessionRail>,
  )
}

describe('SessionRail', () => {
  it('renders nothing while closed', () => {
    rail({ open: false })
    expect(screen.queryByText('the list')).toBeNull()
  })

  it('renders the list when open', () => {
    rail()
    expect(screen.getByText('the list')).toBeTruthy()
  })

  it('offers a resize handle on desktop only', () => {
    rail()
    expect(screen.queryByRole('separator')).not.toBeNull()

    desktop = false
    rail()
    expect(screen.getAllByRole('separator')).toHaveLength(1)
  })

  it('persists the width it starts from', () => {
    window.localStorage.setItem(
      STORAGE_KEYS.sessionRailWidth,
      JSON.stringify(SESSION_RAIL_WIDTH_DEFAULT + 40),
    )
    rail()
    expect(window.localStorage.getItem(STORAGE_KEYS.sessionRailWidth)).toBeTruthy()
  })

  it('asks to be closed from the mobile backdrop', () => {
    desktop = false
    const onClose = vi.fn()
    rail({ onClose })
    fireEvent.click(screen.getByRole('button', { name: /close|关闭/i }))
    expect(onClose).toHaveBeenCalled()
  })

  it('is frosted rather than see-through on desktop', () => {
    // `md:bg-transparent` left the session list sitting on the bare page
    // background with no surface of its own, and the muted text in it dropped
    // under 4.5:1 in light mode. A tinted, blurred panel is the fix; a fully
    // transparent one is the bug, so this asserts the surface is *not*
    // transparent rather than only asserting a blur is present.
    rail()

    const classes = screen.getByText('the list').closest('aside')!.className
    expect(classes).toContain('md:backdrop-blur-xl')
    expect(classes).toContain('md:bg-card/75')
    expect(classes).not.toContain('md:bg-transparent')
  })
})
