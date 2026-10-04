import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { PathDisplay } from './path-display'

/**
 * These render assertions are the reason the component has a test at all.
 * The mapping itself is unit tested in `display-path.test.ts`; what that
 * cannot catch is the component quietly not calling it, or showing the real
 * path in the tooltip - both of which leave the unit tests green while the
 * interface goes back to leaking the account name.
 */
describe('PathDisplay', () => {
  it('shows the workspace under /workspace rather than the real path', () => {
    // maxSegments is generous on purpose: this is about the mapping, and the
    // truncation below is what would otherwise hide the answer.
    render(<PathDisplay path="/workspace/users/aasim/workspace/repos/RelayAB/src" maxSegments={4} />)
    expect(screen.getByText('/workspace/repos/RelayAB/src')).toBeInTheDocument()
  })

  it('shows the assistant directory under /assistant', () => {
    render(<PathDisplay path="/workspace/users/aasim/setting/assistant/.opencode/agents" maxSegments={4} />)
    expect(screen.getByText('/assistant/.opencode/agents')).toBeInTheDocument()
  })

  it('does not leak the account name into the tooltip', () => {
    render(<PathDisplay path="/workspace/users/aasim/workspace/repos/RelayAB/src" maxSegments={4} />)
    // The whole point of shortening is that the on-disk layout stops being
    // part of the interface, and a tooltip is part of the interface.
    const el = screen.getByText('/workspace/repos/RelayAB/src')
    expect(el.getAttribute('title')).toBe('/workspace/repos/RelayAB/src')
    expect(el.getAttribute('title')).not.toContain('aasim')
  })

  it('spends the truncation budget on the part the user is navigating', () => {
    // Shortened first, then truncated: with maxSegments=2 the account name
    // and the layout are gone before the last two segments are chosen.
    render(<PathDisplay path="/workspace/users/aasim/workspace/repos/RelayAB/src/components" maxSegments={2} />)
    expect(screen.getByText('/.../src/components')).toBeInTheDocument()
  })

  it('leaves a repo-relative path alone', () => {
    render(<PathDisplay path="/src/components" maxSegments={4} />)
    expect(screen.getByText('/src/components')).toBeInTheDocument()
  })

  it('renders the root as /', () => {
    const { rerender } = render(<PathDisplay path="/" />)
    expect(screen.getByText('/')).toBeInTheDocument()
    rerender(<PathDisplay path="" />)
    expect(screen.getByText('/')).toBeInTheDocument()
  })
})
