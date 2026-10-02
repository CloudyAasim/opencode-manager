import { describe, it, expect } from 'vitest'
import { act, render, renderHook, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { LayerProvider } from './LayerProvider'
import { useLayer } from './useLayer'

function Location() {
  const location = useLocation()
  return <div data-testid="location">{location.search}</div>
}

function Probe() {
  const [mcp] = useLayer('mcp')
  return <div data-testid="mcp">{mcp ? 'open' : 'closed'}</div>
}

function renderAt(search: string) {
  const client = new QueryClient()
  return render(
    <MemoryRouter initialEntries={[`/${search}`]}>
      <QueryClientProvider client={client}>
        <LayerProvider>
          <Location />
          <Probe />
        </LayerProvider>
      </QueryClientProvider>
    </MemoryRouter>,
  )
}

const location = () => screen.getByTestId('location').textContent

/**
 * LayerProvider used to seed its stack from whatever `?dialog=` said, believe
 * it, and write it straight back. A shared link with a typo - or a name that
 * nothing renders - therefore left the address bar claiming a dialog was open
 * while the page showed nothing, and that phantom entry sat underneath every
 * dialog opened afterwards.
 */
describe('a layer name in the URL', () => {
  it('opens the layer when something actually renders it', async () => {
    renderAt('?dialog=mcp')
    await waitFor(() => expect(screen.getByTestId('mcp')).toHaveTextContent('open'))
  })

  it('is discarded, and removed from the URL, when nothing renders it', async () => {
    renderAt('?dialog=typo')
    await waitFor(() => expect(location()).not.toContain('dialog=typo'))
    expect(screen.getByTestId('mcp')).toHaveTextContent('closed')
  })

  it('does not leave a phantom under a dialog opened afterwards', async () => {
    const client = new QueryClient()
    function Open() {
      const [, setOpen] = useLayer('mcp')
      return <button onClick={() => setOpen(true)}>open mcp</button>
    }
    render(
      <MemoryRouter initialEntries={['/?dialog=typo']}>
        <QueryClientProvider client={client}>
          <LayerProvider>
            <Location />
            <Open />
            <Probe />
          </LayerProvider>
        </QueryClientProvider>
      </MemoryRouter>,
    )
    const button = screen.getByRole('button', { name: 'open mcp' })
    await waitFor(() => expect(location()).not.toContain('typo'))
    await act(async () => {
      button.click()
    })
    await waitFor(() => expect(screen.getByTestId('mcp')).toHaveTextContent('open'))
    // one layer, not two: the address bar names exactly what is open
    await waitFor(() => expect(location()).toBe('?dialog=mcp'))
  })
})

/**
 * The cost of validating is that a name nobody registered simply never opens,
 * silently. The gate catches it in CI; this catches it while you are writing
 * the code.
 */
describe('a layer name nobody registered', () => {
  it('says so rather than quietly never opening', () => {
    const client = new QueryClient()
    const Wrapper = ({ children }: { children: React.ReactNode }) => (
      <MemoryRouter>
        <QueryClientProvider client={client}>
          <LayerProvider>{children}</LayerProvider>
        </QueryClientProvider>
      </MemoryRouter>
    )
    expect(() => renderHook(() => useLayer('neverRegistered'), { wrapper: Wrapper })).toThrow(
      /KNOWN_LAYERS/,
    )
  })
})
