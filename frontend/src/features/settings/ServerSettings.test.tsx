import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ServerSettings } from './ServerSettings'
import {
  getStoredServerUrl,
  setStoredServerUrl,
  listRecentServerUrls,
} from '@/lib/server-selection'

function installStorage(): Map<string, string> {
  const store = new Map<string, string>()
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => { store.set(k, String(v)) },
      removeItem: (k: string) => { store.delete(k) },
      clear: () => { store.clear() },
      key: () => null,
      get length() { return store.size },
    },
  })
  return store
}

describe('ServerSettings', () => {
  let store: Map<string, string>
  let reload: ReturnType<typeof vi.fn>

  beforeEach(() => {
    store = installStorage()
    reload = vi.fn()
    // jsdom's reload is "not implemented"; the panel is only useful if saving
    // really does reload, so the call is asserted rather than stubbed away.
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...window.location, reload, origin: 'https://app.example.com' },
    })
  })

  it('shows what the app is using right now', () => {
    setStoredServerUrl('https://code.example.com')
    render(<ServerSettings />)

    expect(screen.getByLabelText(/server address/i)).toHaveValue('https://code.example.com')
  })

  it('starts empty when nothing was chosen', () => {
    render(<ServerSettings />)
    expect(screen.getByLabelText(/server address/i)).toHaveValue('')
  })

  // A person picks a server by pasting whatever they had to hand, and that is
  // frequently a whole endpoint. The resolved form has to be visible before the
  // save, or the trailing path looks like it survived and the next call goes to
  // `.../api/health/api/health`.
  it('shows the resolved server while typing, not the text typed', async () => {
    const user = userEvent.setup()
    render(<ServerSettings />)

    await user.type(screen.getByLabelText(/server address/i), 'https://code.example.com/v1/audio/transcriptions')

    expect(screen.getByText(/will use:\s*https:\/\/code\.example\.com$/i)).toBeInTheDocument()
  })

  it('says so plainly when the choice means this very page', async () => {
    const user = userEvent.setup()
    setStoredServerUrl('https://code.example.com')
    render(<ServerSettings />)

    const input = screen.getByLabelText(/server address/i)
    await user.clear(input)

    expect(screen.getByText(/the server serving this page/i)).toBeInTheDocument()
  })

  it('stores the normalized server and reloads on save', async () => {
    const user = userEvent.setup()
    render(<ServerSettings />)

    await user.type(screen.getByLabelText(/server address/i), 'code.example.com/v1')
    await user.click(screen.getByRole('button', { name: /save and reload/i }))

    // The raw bytes, not a read-back. Reading it back would normalize a second
    // time and so prove nothing about what was persisted - and the persisted
    // form is what the Electron shell reads from the same key.
    expect(store.get('ocm.serverUrl')).toBe('https://code.example.com')
    // The constants are built at import time, so a reload is the only way every
    // part of the app moves at once. Without it the switch is half-applied.
    expect(reload).toHaveBeenCalled()
  })

  it('will not save when nothing was changed', async () => {
    const user = userEvent.setup()
    setStoredServerUrl('https://code.example.com')
    render(<ServerSettings />)

    const save = screen.getByRole('button', { name: /save and reload/i })
    expect(save).toBeDisabled()

    await user.click(save)
    expect(reload).not.toHaveBeenCalled()
  })

  it('goes back to same origin when the box is emptied', async () => {
    const user = userEvent.setup()
    setStoredServerUrl('https://code.example.com')
    render(<ServerSettings />)

    await user.clear(screen.getByLabelText(/server address/i))
    await user.click(screen.getByRole('button', { name: /save and reload/i }))

    expect(getStoredServerUrl()).toBeNull()
    expect(reload).toHaveBeenCalled()
  })

  it('offers the servers used before, because addresses change', () => {
    setStoredServerUrl('https://one.example.com')
    setStoredServerUrl('https://two.example.com')
    render(<ServerSettings />)

    expect(screen.getByRole('button', { name: 'one.example.com' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'two.example.com' })).toBeInTheDocument()
  })

  it('fills the box from a recent server without saving it yet', async () => {
    const user = userEvent.setup()
    setStoredServerUrl('https://one.example.com')
    setStoredServerUrl('https://two.example.com')
    render(<ServerSettings />)

    await user.click(screen.getByRole('button', { name: 'one.example.com' }))

    expect(screen.getByLabelText(/server address/i)).toHaveValue('https://one.example.com')
    expect(reload).not.toHaveBeenCalled()
  })

  describe('testing the address', () => {
    it('reports a reachable healthy server', async () => {
      const user = userEvent.setup()
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ status: 'healthy' }),
      })
      globalThis.fetch = fetchMock as unknown as typeof fetch

      render(<ServerSettings />)
      await user.type(screen.getByLabelText(/server address/i), 'code.example.com')
      await user.click(screen.getByRole('button', { name: /^test$/i }))

      await waitFor(() => {
        expect(fetchMock).toHaveBeenCalledWith(
          'https://code.example.com/api/health',
          expect.objectContaining({ cache: 'no-store' }),
        )
      })
      expect(screen.queryByText(/could not reach/i)).not.toBeInTheDocument()
    })

    // A server that answers 401 is still a server that is there. Reporting that
    // as a failure would send a person hunting for a typo that does not exist.
    it('reports a non-2xx answer as a status, not as unreachable', async () => {
      const user = userEvent.setup()
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 502,
        json: async () => ({}),
      }) as unknown as typeof fetch

      render(<ServerSettings />)
      await user.type(screen.getByLabelText(/server address/i), 'code.example.com')
      await user.click(screen.getByRole('button', { name: /^test$/i }))

      await waitFor(() => {
        expect(screen.getByText(/502/)).toBeInTheDocument()
      })
    })

    it('reports an unreachable server without crashing', async () => {
      const user = userEvent.setup()
      globalThis.fetch = vi.fn().mockRejectedValue(new Error('ECONNREFUSED')) as unknown as typeof fetch

      render(<ServerSettings />)
      await user.type(screen.getByLabelText(/server address/i), 'nope.invalid')
      await user.click(screen.getByRole('button', { name: /^test$/i }))

      await waitFor(() => {
        expect(screen.getByText(/could not reach/i)).toBeInTheDocument()
      })
    })

    it('says when the server answers but is not healthy', async () => {
      const user = userEvent.setup()
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ status: 'degraded' }),
      }) as unknown as typeof fetch

      render(<ServerSettings />)
      await user.type(screen.getByLabelText(/server address/i), 'code.example.com')
      await user.click(screen.getByRole('button', { name: /^test$/i }))

      await waitFor(() => {
        expect(screen.getByText(/degraded/)).toBeInTheDocument()
      })
    })
  })

  it('remembers a server it was told to test', async () => {
    const user = userEvent.setup()
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ status: 'healthy' }),
    }) as unknown as typeof fetch

    render(<ServerSettings />)
    await user.type(screen.getByLabelText(/server address/i), 'code.example.com')
    await user.click(screen.getByRole('button', { name: /save and reload/i }))

    expect(listRecentServerUrls()).toContain('https://code.example.com')
  })
})