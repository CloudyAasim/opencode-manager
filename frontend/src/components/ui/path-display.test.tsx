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
  const root = '/workspace/users/aasim/workspace'

  it('shows the workspace as /workspace/ from a relative path', () => {
    // This is the shape the browser actually produces. The first version of
    // this feature mapped the relative path on its own, matched nothing, and
    // shipped a header that looked exactly as it always had.
    render(<PathDisplay path="" root={root} maxSegments={4} />)
    expect(screen.getByText('/workspace/')).toBeInTheDocument()
  })

  it('shows paths inside the workspace under /workspace/', () => {
    render(<PathDisplay path="repos/RelayAB/src" root={root} maxSegments={4} />)
    expect(screen.getByText('/workspace/repos/RelayAB/src')).toBeInTheDocument()
  })

  it('shows the assistant directory as /assistant/', () => {
    render(<PathDisplay path="../setting/assistant" root={root} maxSegments={4} />)
    expect(screen.getByText('/assistant/')).toBeInTheDocument()
  })

  it('does not leak the account name into the tooltip', () => {
    render(<PathDisplay path="repos/RelayAB/src" root={root} maxSegments={4} />)
    // The whole point of shortening is that the on-disk layout stops being
    // part of the interface, and a tooltip is part of the interface.
    const el = screen.getByText('/workspace/repos/RelayAB/src')
    expect(el.getAttribute('title')).toBe('/workspace/repos/RelayAB/src')
    expect(el.getAttribute('title')).not.toContain('aasim')
  })

  it('spends the truncation budget on the part the user is navigating', () => {
    // Shortened first, then truncated: with maxSegments=2 the account name
    // and the layout are gone before the last two segments are chosen.
    render(<PathDisplay path="repos/RelayAB/src/components" root={root} maxSegments={2} />)
    expect(screen.getByText('/.../src/components')).toBeInTheDocument()
  })

  it('leaves a repo-relative path alone', () => {
    render(<PathDisplay path="/src/components" maxSegments={4} />)
    expect(screen.getByText('/src/components')).toBeInTheDocument()
  })

  it('renders an unresolved root as /', () => {
    const { rerender } = render(<PathDisplay path="/" />)
    expect(screen.getByText('/')).toBeInTheDocument()
    rerender(<PathDisplay path="" />)
    expect(screen.getByText('/')).toBeInTheDocument()
  })
})
