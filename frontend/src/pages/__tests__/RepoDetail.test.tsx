import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { RepoDetail } from '../RepoDetail'

const mocks = vi.hoisted(() => ({
  getRepo: vi.fn(),
  useSessionsAcrossDirectories: vi.fn(),
  createSessionMutate: vi.fn(),
}))

vi.mock('@/api/repos', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/repos')>()
  return { ...actual, getRepo: mocks.getRepo }
})

vi.mock('@/hooks/useOpenCode', () => ({
  useSessionsAcrossDirectories: mocks.useSessionsAcrossDirectories,
  useCreateSession: () => ({ isPending: mocks.createSessionMutate.mock.calls.length > 0, mutate: mocks.createSessionMutate }),
}))

const readyRepo = { id: 7, fullPath: '/workspace/repos/seven', localPath: 'seven', cloneStatus: 'ready' }

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

let view: ReturnType<typeof render> | null = null

function renderAt() {
  view = render(<RoutesTree />)
}

function rerenderRoutes() {
  view?.rerender(<RoutesTree />)
}

function redirectedSessionId(): string | null {
  const el = document.querySelector('[data-testid="session-page"]')
  return el ? 'matched' : null
}

describe('RepoDetail redirect', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getRepo.mockResolvedValue(readyRepo)
    mocks.useSessionsAcrossDirectories.mockReturnValue({ data: [], isFetched: true })
  })

  it('redirects to the most recent session without rendering the project UI', async () => {
    mocks.useSessionsAcrossDirectories.mockReturnValue({ data: [{ id: 'ses_abc' }], isFetched: true })

    renderAt()

    await waitFor(() => {
      expect(redirectedSessionId()).toBe('matched')
    })
    expect(mocks.createSessionMutate).not.toHaveBeenCalled()
  })

  it('creates a session when the repo has none and redirects to it', async () => {
    mocks.useSessionsAcrossDirectories.mockReturnValue({ data: [], isFetched: true })
    mocks.createSessionMutate.mockImplementation((_vars: unknown, opts: { onSuccess: (s: { id: string }) => void }) => {
      opts.onSuccess({ id: 'ses_new' })
    })

    renderAt()

    await waitFor(() => {
      expect(mocks.createSessionMutate).toHaveBeenCalled()
    })
    await waitFor(() => {
      expect(redirectedSessionId()).toBe('matched')
    })
  })

  it('waits for the session list before deciding to create one', async () => {
    mocks.useSessionsAcrossDirectories.mockReturnValue({ data: [], isFetched: false })

    renderAt()

    await waitFor(() => {
      expect(mocks.getRepo).toHaveBeenCalled()
    })
    expect(mocks.createSessionMutate).not.toHaveBeenCalled()

    mocks.useSessionsAcrossDirectories.mockReturnValue({ data: [{ id: 'ses_late' }], isFetched: true })
    rerenderRoutes()

    await waitFor(() => {
      expect(redirectedSessionId()).toBe('matched')
    })
    expect(mocks.createSessionMutate).not.toHaveBeenCalled()
  })

  it('does not navigate to an undefined session when creation returns no id', async () => {
    mocks.useSessionsAcrossDirectories.mockReturnValue({ data: [], isFetched: true })
    mocks.createSessionMutate.mockImplementation((_vars: unknown, opts: { onSuccess: (s: { id?: string }) => void }) => {
      opts.onSuccess({})
    })

    renderAt()

    await waitFor(() => {
      expect(mocks.createSessionMutate).toHaveBeenCalled()
    })
    await new Promise((resolve) => setTimeout(resolve, 200))
    expect(redirectedSessionId()).toBeNull()
  })

  it('does not create a session while the repo is still cloning', async () => {
    mocks.getRepo.mockResolvedValue({ ...readyRepo, cloneStatus: 'cloning' })
    mocks.useSessionsAcrossDirectories.mockReturnValue({ data: [], isFetched: true })

    renderAt()

    await waitFor(() => {
      expect(mocks.getRepo).toHaveBeenCalled()
    })
    expect(mocks.createSessionMutate).not.toHaveBeenCalled()
  })
})
