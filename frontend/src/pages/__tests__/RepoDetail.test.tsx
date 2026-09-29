import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { RepoDetail } from '../RepoDetail'

const mocks = vi.hoisted(() => ({
  getRepo: vi.fn(),
  fetchMock: vi.fn(),
}))

vi.mock('@/api/repos', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/repos')>()
  return { ...actual, getRepo: mocks.getRepo }
})

vi.stubGlobal('fetch', (input: unknown, init?: unknown) => mocks.fetchMock(input, init))

function RoutesTree() {
  return (
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={['/repos/7']}>
        <Routes>
          <Route path="/repos/:id" element={<RepoDetail />} />
          <Route path="/repos/:id/sessions/:sessionId" element={<div data-testid="session-page" />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  )
}

const readyRepo = { id: 7, fullPath: '/workspace/repos/seven', localPath: 'seven', cloneStatus: 'ready' }

function sessionListResponse(ids: string[]) {
  return new Response(JSON.stringify({ data: ids.map((id) => ({ id })) }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

function redirectTarget(): string | null {
  return document.querySelector('[data-testid="session-page"]') ? 'matched' : null
}

describe('RepoDetail redirect', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getRepo.mockResolvedValue(readyRepo)
  })

  it('redirects to the newest session without painting the project UI', async () => {
    mocks.fetchMock.mockImplementation(async (input: unknown) => {
      const url = String(input)
      if (url.includes('/api/session')) return sessionListResponse(['ses_newest'])
      return jsonResponse({})
    })

    render(<RoutesTree />)
    await waitFor(() => expect(redirectTarget()).toBe('matched'), { timeout: 5000 })
  })

  it('creates a session when the repo has none and redirects to it', async () => {
    mocks.fetchMock.mockImplementation(async (input: unknown, init?: RequestInit) => {
      const url = String(input)
      if (init?.method === 'POST') return jsonResponse({ id: 'ses_created' })
      if (url.includes('/api/session')) return sessionListResponse([])
      return jsonResponse({})
    })

    render(<RoutesTree />)

    await waitFor(() => expect(redirectTarget()).toBe('matched'), { timeout: 5000 })
  })

  it('asks for a single session so the redirect does not wait on a full page', async () => {
    mocks.fetchMock.mockImplementation(async (input: unknown) => {
      const url = String(input)
      if (url.includes('/api/session')) return sessionListResponse(['ses_a'])
      return jsonResponse({})
    })

    render(<RoutesTree />)
    await waitFor(() => expect(redirectTarget()).toBe('matched'), { timeout: 5000 })

    const sessionRequest = mocks.fetchMock.mock.calls
      .map(([url]) => String(url))
      .find((url) => url.includes('/api/session'))
    expect(sessionRequest).toBeDefined()
    expect(sessionRequest).toContain('limit=1')
    expect(sessionRequest).toContain('order=desc')
    expect(sessionRequest).toContain(encodeURIComponent(readyRepo.fullPath))
  })

  it('does not navigate anywhere when the session list request fails', async () => {
    mocks.fetchMock.mockImplementation(async () => {
      throw new Error('network down')
    })

    render(<RoutesTree />)
    await waitFor(() => {
      expect(mocks.fetchMock).toHaveBeenCalled()
    }, { timeout: 5000 })
    await new Promise((resolve) => setTimeout(resolve, 200))

    expect(redirectTarget()).toBeNull()
  })

  it('never builds a session url from a missing id', async () => {
    mocks.fetchMock.mockImplementation(async (input: unknown, init?: RequestInit) => {
      const url = String(input)
      if (init?.method === 'POST') return jsonResponse({})
      if (url.includes('/api/session')) return sessionListResponse([])
      return jsonResponse({})
    })

    render(<RoutesTree />)
    await waitFor(() => {
      expect(mocks.fetchMock).toHaveBeenCalled()
    }, { timeout: 5000 })
    await new Promise((resolve) => setTimeout(resolve, 200))

    expect(redirectTarget()).toBeNull()
  })

  it('does not create a session while the repo is still cloning', async () => {
    mocks.getRepo.mockResolvedValue({ ...readyRepo, cloneStatus: 'cloning' })
    mocks.fetchMock.mockImplementation(async (input: unknown) => {
      const url = String(input)
      if (url.includes('/api/session')) return sessionListResponse([])
      return jsonResponse({})
    })

    render(<RoutesTree />)
    await waitFor(() => {
      expect(mocks.getRepo).toHaveBeenCalled()
    }, { timeout: 5000 })
    await new Promise((resolve) => setTimeout(resolve, 200))

    const posted = mocks.fetchMock.mock.calls.some(([, init]) => (init as RequestInit | undefined)?.method === 'POST')
    expect(posted).toBe(false)
  })
})
