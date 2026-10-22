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
  let originalFetch: typeof globalThis.fetch

  beforeEach(() => {
    store = installStorage()
    reload = vi.fn()
    originalFetch = globalThis.fetch
    // jsdom's reload is "not implemented"; the panel is only useful if saving
    // really does reload, so the call is asserted rather than stubbed away.
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...window.location, reload, origin: 'https://app.example.com' },
    })
  })

  afterEach(() => {
    // The panel asks the client proxy whether there is one, and several cases
    // below answer that question by replacing the global fetch. A case that
    // inherited another's answer would decide it is behind a proxy when it is
    // not - and the order these run in is shuffled.
    globalThis.fetch = originalFetch
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

/**
 * Inside a desktop client the page is served by the client's own proxy, and
 * the address is the proxy's target rather than the origin this page sends
 * its requests to. Writing it into the page's own storage would point the
 * page at a remote origin and undo the one thing the proxy is there for.
 */
describe('ServerSettings behind a client proxy', () => {
  let store: Map<string, string>
  let reload: ReturnType<typeof vi.fn>
  let originalFetch: typeof globalThis.fetch

  function installProxy(target: string, putStatus = 200): ReturnType<typeof vi.fn> {
    const fetchMock = vi.fn(async (url: string, init?: { method?: string }) => {
      if (String(url).includes('/__ocm/target')) {
        // The probe asks; the save tells. They are different requests and the
        // proxy answers them differently.
        if (init?.method !== 'PUT') {
          return { ok: true, status: 200, json: async () => ({ target, secureTransport: false }) }
        }
        if (putStatus === 200) {
          return { ok: true, status: 200, json: async () => ({ target, secureTransport: false }) }
        }
        return { ok: false, status: putStatus, json: async () => ({ error: 'invalid_target', message: 'not an absolute http(s) address' }) }
      }
      return { ok: true, status: 200, json: async () => ({ status: 'healthy' }) }
    })
    globalThis.fetch = fetchMock as unknown as typeof fetch
    return fetchMock
  }

  beforeEach(() => {
    store = installStorage()
    reload = vi.fn()
    originalFetch = globalThis.fetch
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...window.location, reload, origin: 'https://app.example.com' },
    })
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  it('shows the address the proxy points at', async () => {
    installProxy('https://code.example.com')
    render(<ServerSettings />)

    await waitFor(() => {
      expect(screen.getByLabelText(/server address/i)).toHaveValue('https://code.example.com')
    })
  })

  it('saves the address to the proxy, not to the page', async () => {
    const fetchMock = installProxy('https://code.example.com')
    const user = userEvent.setup()
    render(<ServerSettings />)

    await waitFor(() => {
      expect(screen.getByLabelText(/server address/i)).toHaveValue('https://code.example.com')
    })
    await user.clear(screen.getByLabelText(/server address/i))
    await user.type(screen.getByLabelText(/server address/i), 'https://other.example.com')
    await user.click(screen.getByRole('button', { name: /save and reload/i }))

    await waitFor(() => {
      const call = fetchMock.mock.calls.find(([url, init]) =>
        String(url).includes('/__ocm/target') && (init as { method?: string })?.method === 'PUT')
      expect(call).toBeTruthy()
      const body = JSON.parse((call![1] as { body: string }).body) as { target: string }
      expect(body.target).toBe('https://other.example.com')
    })
    // The page's own storage is not where this address belongs: the page must
    // keep talking to its own origin, or the session cookie stops travelling.
    expect(store.get('ocm.serverUrl')).toBeUndefined()
    expect(reload).toHaveBeenCalled()
  })

  it('says why the proxy refused it', async () => {
    installProxy('https://code.example.com', 400)
    const user = userEvent.setup()
    render(<ServerSettings />)

    await waitFor(() => {
      expect(screen.getByLabelText(/server address/i)).toHaveValue('https://code.example.com')
    })
    await user.clear(screen.getByLabelText(/server address/i))
    await user.type(screen.getByLabelText(/server address/i), 'nope')
    await user.click(screen.getByRole('button', { name: /save and reload/i }))

    await waitFor(() => {
      expect(screen.getByText(/absolute http/i)).toBeInTheDocument()
    })
    expect(reload).not.toHaveBeenCalled()
  })

  it('does not offer "the server serving this page" behind a proxy', async () => {
    installProxy('https://code.example.com')
    const user = userEvent.setup()
    render(<ServerSettings />)

    await waitFor(() => {
      expect(screen.getByLabelText(/server address/i)).toHaveValue('https://code.example.com')
    })
    await user.clear(screen.getByLabelText(/server address/i))

    // A proxy needs somewhere to point. There is no "the page's own server"
    // to fall back to.
    expect(screen.getByRole('button', { name: /save and reload/i })).toBeDisabled()
    expect(screen.queryByText(/the server serving this page/i)).not.toBeInTheDocument()
  })
})