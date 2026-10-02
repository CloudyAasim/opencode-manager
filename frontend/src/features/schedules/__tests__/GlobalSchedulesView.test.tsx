import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import type { ReactNode } from 'react'
import { GlobalSchedulesView } from '../GlobalSchedulesView'

const mocks = vi.hoisted(() => ({
  useAllSchedules: vi.fn(),
  useAllScheduleRuns: vi.fn(),
  useCancelRepoScheduleRun: vi.fn(),
  useDeleteRepoSchedule: vi.fn(),
  useRunRepoSchedule: vi.fn(),
  useUpdateRepoSchedule: vi.fn(),
  useCreateRepoSchedule: vi.fn(),
  useScheduleUrlState: vi.fn(),
  useSidebarAction: vi.fn(),
  navigate: vi.fn(),
}))

vi.mock('react-router-dom', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-router-dom')>()),
  useNavigate: () => mocks.navigate,
}))

vi.mock('@/hooks/useSchedules', () => ({
  useAllSchedules: mocks.useAllSchedules,
  useAllScheduleRuns: mocks.useAllScheduleRuns,
  useCancelRepoScheduleRun: mocks.useCancelRepoScheduleRun,
  useDeleteRepoSchedule: mocks.useDeleteRepoSchedule,
  useRunRepoSchedule: mocks.useRunRepoSchedule,
  useUpdateRepoSchedule: mocks.useUpdateRepoSchedule,
  useCreateRepoSchedule: mocks.useCreateRepoSchedule,
}))

vi.mock('@/hooks/useScheduleUrlState', () => ({ useScheduleUrlState: mocks.useScheduleUrlState }))
vi.mock('@/hooks/useSidebarAction', () => ({ useSidebarAction: mocks.useSidebarAction }))

const job = {
  id: 'job-1',
  repoId: 7,
  repoName: 'alpha',
  repoPath: '/w/alpha',
  enabled: true,
  scheduleType: 'cron',
  cronExpression: '0 9 * * *',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  nextRunAt: null,
  lastRunAt: null,
  prompt: 'do the thing',
}

const deleteMutate = vi.fn()
const closeDialog = vi.fn()
const openDeleteJob = vi.fn()

function renderView() {
  const client = new QueryClient()
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <MemoryRouter>
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    </MemoryRouter>
  )
  return render(<GlobalSchedulesView />, { wrapper: Wrapper })
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.useSidebarAction.mockReturnValue({})
  mocks.useCancelRepoScheduleRun.mockReturnValue({ mutate: vi.fn(), isPending: false })
  mocks.useRunRepoSchedule.mockReturnValue({ mutate: vi.fn(), isPending: false })
  mocks.useUpdateRepoSchedule.mockReturnValue({ mutate: vi.fn(), isPending: false })
  mocks.useCreateRepoSchedule.mockReturnValue({ mutate: vi.fn(), isPending: false })
  mocks.useDeleteRepoSchedule.mockReturnValue({ mutate: deleteMutate, isPending: false })
  mocks.useAllScheduleRuns.mockReturnValue({ data: [], isLoading: false })
  mocks.useScheduleUrlState.mockReturnValue({
    scheduleTab: 'jobs',
    setScheduleTab: vi.fn(),
    dialog: null,
    promptDialog: null,
    jobId: null,
    runId: null,
    templateId: null,
    openNewJob: vi.fn(),
    openEditJob: vi.fn(),
    openDeleteJob,
    openNewTemplate: vi.fn(),
    openEditTemplate: vi.fn(),
    openDeleteTemplate: vi.fn(),
    openImportTemplate: vi.fn(),
    closeDialog,
    closePromptDialog: vi.fn(),
    selectRun: vi.fn(),
  })
})

/**
 * This is the largest component in the frontend and nothing rendered it. The
 * behaviours worth pinning are the ones a user can get stranded by, and the
 * one shape that was wrong twice elsewhere: closing a confirm dialog before the
 * write lands. Here it already closes in onSuccess, and this is what stops
 * that being quietly undone.
 */
describe('GlobalSchedulesView', () => {
  it('shows a loading state rather than an empty page', () => {
    mocks.useAllSchedules.mockReturnValue({ data: [], isLoading: true, error: null })
    renderView()
    expect(screen.getByRole('status')).toBeInTheDocument()
  })

  it('offers a working way back when loading failed, instead of stranding the user', async () => {
    mocks.useAllSchedules.mockReturnValue({ data: [], isLoading: false, error: new Error('boom') })
    const user = userEvent.setup()
    renderView()
    // not just that the button is there - that it actually goes somewhere
    await user.click(screen.getByRole('button', { name: /back/i }))
    expect(mocks.navigate).toHaveBeenCalledWith('/')
  })

  it('closes the delete dialog only once the delete lands', async () => {
    mocks.useAllSchedules.mockReturnValue({ data: [job], isLoading: false, error: null })
    mocks.useScheduleUrlState.mockReturnValue({
      ...mocks.useScheduleUrlState(),
      dialog: 'delete',
      jobId: 'job-1',
    })
    let release!: (v: unknown) => void
    deleteMutate.mockImplementation((_vars: unknown, opts: { onSuccess: () => void }) => {
      release = opts.onSuccess
    })
    const user = userEvent.setup()
    renderView()

    const confirm = await screen.findByRole('button', { name: /^delete$/i })
    await user.click(confirm)

    // still open, and nothing closed on our behalf
    expect(closeDialog).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: /^delete$/i })).toBeInTheDocument()

    release()
    await waitFor(() => expect(closeDialog).toHaveBeenCalled())
  })
})
