import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act, cleanup, waitFor } from '@testing-library/react'
import { TerminalView } from './TerminalView'
import { terminalApi } from '@/api/terminal'

/**
 * The status line under the terminal title says where the session is.
 *
 * `session.cwd` is the path on the host. For a non-admin that is not a path
 * their shell can name: the sandbox binds their workspace directory at
 * `/workspace`, so `pwd` inside says `/workspace/repos/RelayAB` while the
 * session says `/workspace/users/<name>/workspace/repos/RelayAB` - a
 * directory that does not exist from where the person is standing, with their
 * own account name in it.
 *
 * This file exists because the shortening lives in a render site, and a
 * shortening verified only at its own function is not verified: that is how
 * the file browser shipped the same path twice, once shortened and once raw.
 * So these tests drive the component and read the text it actually produced.
 */

vi.mock('@xterm/xterm', () => ({
  Terminal: class {
    cols = 120
    rows = 30
    loadAddon() {}
    open() {}
    write() {}
    dispose() {}
    onData() {
      return { dispose() {} }
    }
    onResize() {
      return { dispose() {} }
    }
  },
}))

vi.mock('@xterm/addon-fit', () => ({
  FitAddon: class {
    fit() {}
  },
}))

vi.mock('@/api/terminal', () => ({
  terminalApi: {
    createSession: vi.fn(),
    // The component chains `.catch()` onto each of these without a guard, so a
    // mock that returns undefined is not a harmless stub - it throws during
    // unmount and takes the test with it.
    sendInput: vi.fn(() => Promise.resolve()),
    resize: vi.fn(() => Promise.resolve()),
    close: vi.fn(() => Promise.resolve()),
    streamUrl: (id: string) => `/api/terminal/sessions/${id}/stream`,
  },
}))

vi.mock('@/lib/i18n', () => ({
  useI18n: () => ({ t: (key: string) => key }),
}))

class FakeEventSource {
  static last: FakeEventSource | null = null
  private readonly listeners = new Map<string, (event: MessageEvent) => void>()
  onerror: (() => void) | null = null

  constructor(
    public url: string,
    public init?: EventSourceInit,
  ) {
    FakeEventSource.last = this
  }

  addEventListener(type: string, listener: (event: MessageEvent) => void) {
    this.listeners.set(type, listener)
  }

  removeEventListener(type: string) {
    this.listeners.delete(type)
  }

  close() {}

  /** Delivers a server event the way the real stream does: JSON in `data`. */
  emit(type: string, payload: unknown) {
    this.listeners.get(type)?.({ data: JSON.stringify(payload) } as MessageEvent)
  }
}

/** Renders the view and answers `ready` with the cwd the server reported. */
async function renderWithSessionCwd(cwd: string) {
  vi.mocked(terminalApi.createSession).mockResolvedValue({
    id: 'sess-1',
    cols: 120,
    rows: 30,
  } as Awaited<ReturnType<typeof terminalApi.createSession>>)

  render(<TerminalView />)

  await waitFor(() => expect(FakeEventSource.last).not.toBeNull())

  await act(async () => {
    FakeEventSource.last!.emit('ready', { session: { cwd } })
  })
}

beforeEach(() => {
  FakeEventSource.last = null
  vi.stubGlobal('EventSource', FakeEventSource)
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

describe('the terminal status line names a directory the shell can reach', () => {
  it('shows a non-admin a repository under /workspace, not their host path', async () => {
    await renderWithSessionCwd('/workspace/users/aaa/workspace/repos/RelayAB')

    // The user's own `pwd` reads /workspace/repos/RelayAB. The header used to
    // say /workspace/users/aaa/workspace/repos/RelayAB - a directory that does
    // not exist inside the sandbox, carrying the account name with it.
    await waitFor(() => {
      expect(screen.getByText(/\/workspace\/repos\/RelayAB/)).toBeInTheDocument()
    })
    expect(screen.queryByText(/users\/aaa/)).not.toBeInTheDocument()
  })

  it('marks the workspace root with a trailing slash', async () => {
    await renderWithSessionCwd('/workspace/users/aaa/workspace')

    // `/workspace/` rather than `/workspace`: the rest of the interface uses
    // the slash to mean "you are at the root", and this line sits next to it.
    await waitFor(() => {
      expect(screen.getByText(/\/workspace\/$/)).toBeInTheDocument()
    })
  })

  it('leaves an admin path alone', async () => {
    await renderWithSessionCwd('/workspace/repos/RelayAB')

    // The admin's path has no `users/<name>/` segment to shorten, so it must
    // come through exactly as the server sent it.
    await waitFor(() => {
      expect(screen.getByText(/\/workspace\/repos\/RelayAB/)).toBeInTheDocument()
    })
  })

  it('still says which directory it is, next to the connection state', async () => {
    await renderWithSessionCwd('/workspace/users/aaa/workspace/repos/RelayAB')

    await waitFor(() => {
      expect(screen.getByText('terminal.connected')).toBeInTheDocument()
    })
    expect(screen.getByText(/terminal\.workingDirectory/)).toBeInTheDocument()
  })
})

describe('shortening the status line must not reach the request', () => {
  it('asks the server for the real directory, not the shortened one', async () => {
    vi.mocked(terminalApi.createSession).mockResolvedValue({
      id: 'sess-1',
      cols: 120,
      rows: 30,
    } as Awaited<ReturnType<typeof terminalApi.createSession>>)

    render(<TerminalView cwd="/workspace/users/aaa/workspace/repos/RelayAB" />)

    await waitFor(() => expect(terminalApi.createSession).toHaveBeenCalled())

    // The display fix is one call to a pure function in the JSX. If someone
    // later reaches for the same function where the `cwd` prop is handed to
    // the server, the server would be told `/workspace/repos/RelayAB` - a
    // directory that does not exist for a non-admin, so the session would
    // start somewhere else or be rejected. Nothing about a display change
    // is allowed to move a request.
    expect(terminalApi.createSession).toHaveBeenCalledWith(
      expect.objectContaining({ cwd: '/workspace/users/aaa/workspace/repos/RelayAB' }),
    )
  })
})
