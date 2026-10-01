import type { Database } from 'bun:sqlite'
import { type CreateScheduleJobRequest, type ScheduleJob, type ScheduleRun, type ScheduleRunTriggerSource, type UpdateScheduleJobRequest } from '@opencode-manager/shared/types'
import { buildSchedulePermissionRuleset } from '@opencode-manager/shared/schemas'
import { getRepoById } from '../../db/queries'
import type { ScheduleJobWithRepo } from '../../db/schedules'
import { cleanupOrphanedSchedules, createScheduleJob, createScheduleRun, deleteScheduleJob, deleteScheduleRunById, deleteScheduleRunsByIds, getScheduleJobById, getRunningScheduleRunByJob, getScheduleRunById, listAllScheduleJobsWithRepos, listScheduleRunArtifactsByJob, listAllScheduleRuns, listEnabledScheduleJobs, listScheduleJobIdsByRepo, listScheduleJobsByRepo, listRunningScheduleRuns, listScheduleRunsByJob, updateScheduleJob, updateScheduleJobRunState, updateScheduleRun, updateScheduleRunMetadata, updateScheduleRunWorktree } from '../../db/schedules'
import type { ListAllRunsOptions, ScheduleRunWithContext } from '../../db/schedules'
import { buildCreateSchedulePersistenceInput, buildUpdatedSchedulePersistenceInput, computeNextRunAtForJob } from '../schedule-config'
import { resolveOpenCodeModel } from '../opencode-models'
import type { OpenCodeClient } from '../opencode/client'
import type { ScheduleWorktreeManager } from '../schedule-worktree'
import type { Repo } from '../../types/repo'
import { type ScheduledSessionRef } from '../sse-aggregator'
import { getErrorMessage } from '../../utils/error-utils'
import { logger } from '../../utils/logger'
import { buildAssistantRepo } from '../assistant-mode'
import { ASSISTANT_REPO_ID } from '@opencode-manager/shared/utils'
import { SESSION_STOPPED_ERROR, buildPromptWithSkills, buildRunLog, buildRunStartedLog, buildSessionTitle, createSessionMonitor, getAssistantMessageState } from './session-monitor'
import type { AssistantOutcome, SessionMessage, SessionMonitor, SessionResponse, SessionStatus } from './session-monitor'

class ScheduleServiceError extends Error {
  status: number

  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

export class ScheduleService {
  private static activeRuns = new Set<number>()
  private static activeTeardowns = new Set<string>()
  private onJobChange: ((job: ScheduleJob | null, jobId: number) => void) | null = null

  constructor(
    private readonly db: Database,
    private readonly openCodeClient: OpenCodeClient,
    private readonly worktreeManager: ScheduleWorktreeManager,
  ) {}

  setJobChangeHandler(handler: ((job: ScheduleJob | null, jobId: number) => void) | null): void {
    this.onJobChange = handler
  }

  getActiveRunSessions(): ScheduledSessionRef[] {
    const refs: ScheduledSessionRef[] = []

    for (const run of listRunningScheduleRuns(this.db)) {
      if (!run.sessionId) continue

      const directory = run.worktreePath ?? this.findRepoPath(run.repoId)
      if (!directory) continue

      refs.push({ sessionID: run.sessionId, directory })
    }

    return refs
  }

  private findRepoPath(repoId: number): string | null {
    try {
      return this.assertRepo(repoId).fullPath
    } catch {
      return null
    }
  }

  listAllEnabledJobs(): ScheduleJob[] {
    return listEnabledScheduleJobs(this.db)
  }

  listAllJobsWithRepos(): ScheduleJobWithRepo[] {
    return listAllScheduleJobsWithRepos(this.db)
  }

  listAllRuns(options: ListAllRunsOptions = {}): ScheduleRunWithContext[] {
    const limit = Math.min(Math.max(options.limit ?? 20, 1), 100)
    const offset = Math.max(options.offset ?? 0, 0)
    return listAllScheduleRuns(this.db, { ...options, limit, offset })
  }

  async recoverRunningRuns(): Promise<void> {
    const runningRuns = listRunningScheduleRuns(this.db)

    for (const run of runningRuns) {
      const job = getScheduleJobById(this.db, run.repoId, run.jobId)
      if (!job) {
        continue
      }

      if (ScheduleService.activeRuns.has(job.id)) {
        continue
      }

      ScheduleService.activeRuns.add(job.id)
      await this.recoverRunningRun(job, run)
    }
  }

  listJobs(repoId: number): ScheduleJob[] {
    this.assertRepo(repoId)
    return listScheduleJobsByRepo(this.db, repoId)
  }

  getJob(repoId: number, jobId: number): ScheduleJob | null {
    return getScheduleJobById(this.db, repoId, jobId)
  }

  createJob(repoId: number, input: CreateScheduleJobRequest): ScheduleJob {
    this.assertRepo(repoId)

    try {
      const job = createScheduleJob(this.db, repoId, buildCreateSchedulePersistenceInput(input))
      this.onJobChange?.(job, job.id)
      return job
    } catch (error) {
      throw new ScheduleServiceError(getErrorMessage(error), 400)
    }
  }

  updateJob(repoId: number, jobId: number, input: UpdateScheduleJobRequest): ScheduleJob {
    this.assertRepo(repoId)
    const existing = this.assertJob(repoId, jobId)
    let job: ScheduleJob | null

    try {
      job = updateScheduleJob(this.db, repoId, jobId, buildUpdatedSchedulePersistenceInput(existing, input))
    } catch (error) {
      throw new ScheduleServiceError(getErrorMessage(error), 400)
    }

    if (!job) {
      throw new ScheduleServiceError('Schedule not found', 404)
    }
    this.onJobChange?.(job, job.id)
    return job
  }

  deleteJob(repoId: number, jobId: number): void {
    this.assertRepo(repoId)
    this.assertJob(repoId, jobId)

    if (ScheduleService.activeRuns.has(jobId)) {
      throw new ScheduleServiceError('Cannot delete a schedule while it is running. Cancel the run first.', 409)
    }

    const runningRun = getRunningScheduleRunByJob(this.db, repoId, jobId)
    if (runningRun) {
      throw new ScheduleServiceError('Cannot delete a schedule while it is running. Cancel the run first.', 409)
    }

    const deleted = deleteScheduleJob(this.db, repoId, jobId)
    if (!deleted) {
      throw new ScheduleServiceError('Schedule not found', 404)
    }
    this.onJobChange?.(null, jobId)
  }

  prepareRepoDelete(repoId: number): void {
    const jobIds = listScheduleJobIdsByRepo(this.db, repoId)
    for (const jobId of jobIds) {
      if (ScheduleService.activeRuns.has(jobId)) {
        throw new ScheduleServiceError('Cannot delete a repo while a schedule run is in progress. Cancel the run first.', 409)
      }

      const runningRun = getRunningScheduleRunByJob(this.db, repoId, jobId)
      if (runningRun) {
        throw new ScheduleServiceError('Cannot delete a repo while a schedule run is in progress. Cancel the run first.', 409)
      }

      this.onJobChange?.(null, jobId)
    }
  }

  cleanupOrphanedSchedules(): { orphanedJobs: number; orphanedRuns: number } {
    const result = cleanupOrphanedSchedules(this.db)
    if (result.orphanedJobs > 0 || result.orphanedRuns > 0) {
      logger.info(`Cleaned up ${result.orphanedJobs} orphaned schedule job(s) and ${result.orphanedRuns} run(s)`)
    }
    return result
  }

  listRuns(repoId: number, jobId: number, limit: number = 20): ScheduleRun[] {
    this.assertJob(repoId, jobId)
    return listScheduleRunsByJob(this.db, repoId, jobId, limit)
  }

  getRun(repoId: number, jobId: number, runId: number): ScheduleRun {
    this.assertJob(repoId, jobId)
    const run = getScheduleRunById(this.db, repoId, jobId, runId)
    if (!run) {
      throw new ScheduleServiceError('Run not found', 404)
    }
    return run
  }

  async clearRunHistory(repoId: number, jobId: number): Promise<{ cleared: number }> {
    const repo = this.assertRepo(repoId)
    this.assertJob(repoId, jobId)

    const removable = listScheduleRunArtifactsByJob(this.db, repoId, jobId).filter((run) => run.status !== 'running')
    if (removable.length === 0) {
      return { cleared: 0 }
    }

    await this.worktreeManager.pruneRunArtifacts(repo, removable)
    const cleared = deleteScheduleRunsByIds(this.db, repoId, jobId, removable.map((run) => run.id))
    return { cleared }
  }

  async deleteRun(repoId: number, jobId: number, runId: number): Promise<void> {
    const repo = this.assertRepo(repoId)
    this.assertJob(repoId, jobId)
    const run = this.getRun(repoId, jobId, runId)

    if (run.status === 'running') {
      throw new ScheduleServiceError('Cannot delete a run while it is in progress. Cancel it first.', 409)
    }

    await this.worktreeManager.pruneRunArtifacts(repo, [{ runBranch: run.runBranch, worktreePath: run.worktreePath, workspaceId: run.workspaceId }])
    const deleted = deleteScheduleRunById(this.db, repoId, jobId, runId)
    if (!deleted) {
      throw new ScheduleServiceError('Run not found', 404)
    }
  }

  async runJob(repoId: number, jobId: number, triggerSource: ScheduleRunTriggerSource): Promise<ScheduleRun> {
    const repo = this.assertRepo(repoId)
    const job = this.assertJob(repoId, jobId)

    const existingRunningRun = getRunningScheduleRunByJob(this.db, repoId, jobId)
    if (existingRunningRun) {
      throw new ScheduleServiceError('Schedule is already running', 409)
    }

    if (ScheduleService.activeRuns.has(jobId)) {
      throw new ScheduleServiceError('Schedule is already running', 409)
    }

    ScheduleService.activeRuns.add(jobId)

    const startedAt = Date.now()
    const run = createScheduleRun(this.db, {
      jobId,
      repoId,
      triggerSource,
      status: 'running',
      startedAt,
      createdAt: startedAt,
    })

    try {
      const wt = await this.worktreeManager.prepare(repo, job, run.id)
      const runDirectory = wt?.directory ?? repo.fullPath
      if (wt) {
        updateScheduleRunWorktree(this.db, repoId, jobId, run.id, {
          worktreePath: wt.worktreePath,
          runBranch: wt.runBranch,
          workspaceId: wt.workspaceId,
        })
      }

      const model = await resolveOpenCodeModel(this.openCodeClient, runDirectory, {
        preferredModel: job.model,
      })
      const sessionTitle = buildSessionTitle(job)
      const sessionResponse = await this.openCodeClient.forward({
        method: 'POST',
        path: '/session',
        directory: runDirectory,
        body: JSON.stringify({
          title: sessionTitle,
          agent: job.agentSlug ?? undefined,
          permission: buildSchedulePermissionRuleset(job.permissionConfig),
        }),
        headers: { 'Content-Type': 'application/json' },
      })

      if (!sessionResponse.ok) {
        throw new ScheduleServiceError('Failed to create OpenCode session', 502)
      }

      const session = await sessionResponse.json() as SessionResponse
      const runWithSession = updateScheduleRunMetadata(this.db, repoId, jobId, run.id, {
        sessionId: session.id,
        sessionTitle,
        logText: buildRunStartedLog({
          job,
          triggerSource,
          sessionId: session.id,
          sessionTitle,
        }),
      })

      if (!runWithSession) {
        throw new ScheduleServiceError('Failed to attach session to run', 500)
      }

      const sessionMonitor = createSessionMonitor(runDirectory, session.id)

      void this.submitPromptAndMonitor({
        repoId,
        job,
        runId: run.id,
        sessionId: session.id,
        sessionTitle,
        triggerSource,
        model,
        sessionMonitor,
        directory: runDirectory,
      })

      return runWithSession
    } catch (error) {
      const finishedAt = Date.now()
      const errorText = getErrorMessage(error)
      logger.error(`Failed to run schedule ${jobId}:`, error)

      const failedRun = updateScheduleRun(this.db, repoId, jobId, run.id, {
        status: 'failed',
        finishedAt,
        errorText,
        logText: buildRunLog({
          job,
          triggerSource,
          errorText,
          finishedAt,
        }),
      })

      try {
        updateScheduleJobRunState(this.db, repoId, jobId, {
          lastRunAt: finishedAt,
          nextRunAt: triggerSource === 'manual' ? job.nextRunAt : computeNextRunAtForJob(job, finishedAt),
        })
      } catch (updateError) {
        logger.error(`Failed to update job state for job ${jobId}:`, updateError)
      }

      await this.teardownWorktree(repoId, jobId, run.id, job, repo)

      if (!failedRun) {
        ScheduleService.activeRuns.delete(jobId)
        throw new ScheduleServiceError('Failed to load failed run', 500)
      }

      if (error instanceof ScheduleServiceError) {
        ScheduleService.activeRuns.delete(jobId)
        throw error
      }

      ScheduleService.activeRuns.delete(jobId)
      throw new ScheduleServiceError(errorText, 500)
    }
  }

  async cancelRun(repoId: number, jobId: number, runId: number): Promise<ScheduleRun> {
    const repo = this.assertRepo(repoId)
    const job = this.assertJob(repoId, jobId)
    const run = this.getRun(repoId, jobId, runId)

    if (run.status !== 'running') {
      throw new ScheduleServiceError('Only running schedule runs can be cancelled', 409)
    }

    const runDirectory = run.worktreePath ?? repo.fullPath

    if (run.sessionId) {
      const messages = await this.listSessionMessages(runDirectory, run.sessionId)
      const assistantState = getAssistantMessageState(messages)

      if (assistantState?.completed || assistantState?.errorText) {
        await this.finalizeRecoveredRun(job, run, {
          status: assistantState.errorText ? 'failed' : 'completed',
          responseText: assistantState.responseText,
          errorText: assistantState.errorText,
        }, repo)

        return this.getRun(repoId, jobId, runId)
      }

      const abortResponse = await this.openCodeClient.forward({
        method: 'POST',
        path: `/session/${run.sessionId}/abort`,
        directory: runDirectory,
      })

      if (!abortResponse.ok) {
        const errorText = await abortResponse.text()
        throw new ScheduleServiceError(errorText || 'Failed to cancel schedule run', 502)
      }
    }

    const finishedAt = Date.now()
    const cancellationMessage = 'Run cancelled by user.'
    const cancelledRun = updateScheduleRun(this.db, repoId, jobId, runId, {
      status: 'cancelled',
      finishedAt,
      sessionId: run.sessionId,
      sessionTitle: run.sessionTitle,
      errorText: cancellationMessage,
      responseText: run.responseText,
      logText: buildRunLog({
        job,
        triggerSource: run.triggerSource,
        sessionId: run.sessionId,
        sessionTitle: run.sessionTitle,
        responseText: run.responseText,
        errorText: cancellationMessage,
        finishedAt,
      }),
    })

    updateScheduleJobRunState(this.db, repoId, jobId, {
      lastRunAt: finishedAt,
      nextRunAt: job.nextRunAt,
    })

    await this.teardownWorktree(repoId, jobId, runId, job, repo)
    ScheduleService.activeRuns.delete(jobId)

    if (!cancelledRun) {
      throw new ScheduleServiceError('Failed to update cancelled run', 500)
    }

    return cancelledRun
  }

  private async submitPromptAndMonitor(input: {
    repoId: number
    job: ScheduleJob
    runId: number
    sessionId: string
    sessionTitle: string
    triggerSource: ScheduleRunTriggerSource
    model: { providerID: string; modelID: string }
    sessionMonitor: SessionMonitor
    directory: string
  }): Promise<void> {
    const repo = this.assertRepo(input.repoId)

    try {
      const promptResponse = await this.openCodeClient.forward({
        method: 'POST',
        path: `/session/${input.sessionId}/prompt_async`,
        directory: input.directory,
        body: JSON.stringify({
          parts: [{ type: 'text', text: await buildPromptWithSkills(input.job.prompt, input.job.skillMetadata, input.directory, this.openCodeClient) }],
          model: input.model,
        }),
        headers: { 'Content-Type': 'application/json' },
      })

      if (!promptResponse.ok) {
        const errorText = await promptResponse.text()
        throw new ScheduleServiceError(errorText || 'Failed to run scheduled prompt', 502)
      }

      input.sessionMonitor.markSubmitted()

      await this.monitorRunCompletion({
        sessionMonitor: input.sessionMonitor,
        repoId: input.repoId,
        job: input.job,
        runId: input.runId,
        sessionId: input.sessionId,
        sessionTitle: input.sessionTitle,
        triggerSource: input.triggerSource,
        directory: input.directory,
      })
      return
    } catch (error) {
      const finishedAt = Date.now()
      const errorText = getErrorMessage(error)
      logger.error(`Failed to submit prompt for schedule ${input.job.id}:`, error)

      const currentRun = getScheduleRunById(this.db, input.repoId, input.job.id, input.runId)
      if (!currentRun || currentRun.status !== 'running') {
        return
      }

      updateScheduleRun(this.db, input.repoId, input.job.id, input.runId, {
        status: 'failed',
        finishedAt,
        sessionId: input.sessionId,
        sessionTitle: input.sessionTitle,
        errorText,
        logText: buildRunLog({
          job: input.job,
          triggerSource: input.triggerSource,
          sessionId: input.sessionId,
          sessionTitle: input.sessionTitle,
          errorText,
          finishedAt,
        }),
      })

      updateScheduleJobRunState(this.db, input.repoId, input.job.id, {
        lastRunAt: finishedAt,
        nextRunAt: input.triggerSource === 'manual' ? input.job.nextRunAt : computeNextRunAtForJob(input.job, finishedAt),
      })
    } finally {
      input.sessionMonitor.dispose()
      await this.teardownWorktree(input.repoId, input.job.id, input.runId, input.job, repo)
      ScheduleService.activeRuns.delete(input.job.id)
    }
  }

  private async monitorRunCompletion(input: {
    sessionMonitor: SessionMonitor
    repoId: number
    job: ScheduleJob
    runId: number
    sessionId: string
    sessionTitle: string
    triggerSource: ScheduleRunTriggerSource
    directory: string
    initialSessionStatus?: SessionStatus
  }): Promise<void> {
    try {
      const sessionStatus = input.initialSessionStatus
      if (sessionStatus && sessionStatus.type === 'idle') {
        const repo = this.assertRepo(input.repoId)
        const messages = await this.listSessionMessages(input.directory, input.sessionId)
        const assistantState = getAssistantMessageState(messages)
        if (assistantState?.completed || assistantState?.errorText) {
          await this.finalizeRecoveredRun(input.job, {
            id: input.runId,
            repoId: input.repoId,
            jobId: input.job.id,
            sessionId: input.sessionId,
            sessionTitle: input.sessionTitle,
            triggerSource: input.triggerSource,
          } as ScheduleRun, {
            status: assistantState.errorText ? 'failed' : 'completed',
            responseText: assistantState.responseText,
            errorText: assistantState.errorText,
          }, repo)
          return
        }
      }

      const repo = this.assertRepo(input.repoId)
      const currentAssistantState = await this.readSettledAssistantState(input.directory, input.sessionId)
      if (currentAssistantState) {
        await this.finalizeRecoveredRun(input.job, {
          id: input.runId,
          repoId: input.repoId,
          jobId: input.job.id,
          sessionId: input.sessionId,
          sessionTitle: input.sessionTitle,
          triggerSource: input.triggerSource,
        } as ScheduleRun, {
          status: currentAssistantState.errorText ? 'failed' : 'completed',
          responseText: currentAssistantState.responseText,
          errorText: currentAssistantState.errorText,
        }, repo)
        return
      }

      const response = await this.waitForAssistantMessage(input.sessionId, input.sessionMonitor, input.directory)
      const currentRun = getScheduleRunById(this.db, input.repoId, input.job.id, input.runId)
      if (!currentRun || currentRun.status !== 'running') {
        return
      }

      const finishedAt = Date.now()

      if (response.errorText) {
        updateScheduleRun(this.db, input.repoId, input.job.id, input.runId, {
          status: 'failed',
          finishedAt,
          sessionId: input.sessionId,
          sessionTitle: input.sessionTitle,
          errorText: response.errorText,
          responseText: response.responseText,
          logText: buildRunLog({
            job: input.job,
            triggerSource: input.triggerSource,
            sessionId: input.sessionId,
            sessionTitle: input.sessionTitle,
            responseText: response.responseText,
            errorText: response.errorText,
            finishedAt,
          }),
        })
      } else {
        updateScheduleRun(this.db, input.repoId, input.job.id, input.runId, {
          status: 'completed',
          finishedAt,
          sessionId: input.sessionId,
          sessionTitle: input.sessionTitle,
          responseText: response.responseText,
          logText: buildRunLog({
            job: input.job,
            triggerSource: input.triggerSource,
            sessionId: input.sessionId,
            sessionTitle: input.sessionTitle,
            responseText: response.responseText,
            finishedAt,
          }),
        })
      }

      updateScheduleJobRunState(this.db, input.repoId, input.job.id, {
        lastRunAt: finishedAt,
        nextRunAt: input.triggerSource === 'manual' ? input.job.nextRunAt : computeNextRunAtForJob(input.job, finishedAt),
      })
    } catch (error) {
      const finishedAt = Date.now()
      const errorText = getErrorMessage(error)
      logger.error(`Failed to monitor schedule ${input.job.id}:`, error)

      const currentRun = getScheduleRunById(this.db, input.repoId, input.job.id, input.runId)
      if (!currentRun || currentRun.status !== 'running') {
        return
      }

      updateScheduleRun(this.db, input.repoId, input.job.id, input.runId, {
        status: 'failed',
        finishedAt,
        sessionId: input.sessionId,
        sessionTitle: input.sessionTitle,
        errorText,
        logText: buildRunLog({
          job: input.job,
          triggerSource: input.triggerSource,
          sessionId: input.sessionId,
          sessionTitle: input.sessionTitle,
          errorText,
          finishedAt,
        }),
      })

      updateScheduleJobRunState(this.db, input.repoId, input.job.id, {
        lastRunAt: finishedAt,
        nextRunAt: input.triggerSource === 'manual' ? input.job.nextRunAt : computeNextRunAtForJob(input.job, finishedAt),
      })
    } finally {
      input.sessionMonitor.dispose()
      await this.teardownWorktree(input.repoId, input.job.id, input.runId, input.job, this.assertRepo(input.repoId))
      ScheduleService.activeRuns.delete(input.job.id)
    }
  }

  private async recoverRunningRun(job: ScheduleJob, run: ScheduleRun): Promise<void> {
    try {
      const repo = this.assertRepo(job.repoId)
      const runDirectory = run.worktreePath ?? repo.fullPath

      if (!run.sessionId) {
        await this.finalizeRecoveredRun(job, run, {
          status: 'failed',
          errorText: 'This run was interrupted before completion and had no linked session to recover.',
        }, repo)
        return
      }

      const messages = await this.listSessionMessages(runDirectory, run.sessionId)
      const assistantState = getAssistantMessageState(messages)

      if (assistantState?.completed || assistantState?.errorText) {
        await this.finalizeRecoveredRun(job, run, {
          status: assistantState.errorText ? 'failed' : 'completed',
          responseText: assistantState.responseText,
          errorText: assistantState.errorText,
        }, repo)
        return
      }

      const sessionStatuses = await this.getSessionStatuses(runDirectory)
      const sessionStatus = run.sessionId ? sessionStatuses[run.sessionId] : undefined

      if (sessionStatus && sessionStatus.type !== 'idle') {
        const sessionMonitor = createSessionMonitor(runDirectory, run.sessionId)
        void this.monitorRunCompletion({
          sessionMonitor,
          repoId: run.repoId,
          job,
          runId: run.id,
          sessionId: run.sessionId,
          sessionTitle: run.sessionTitle ?? buildSessionTitle(job),
          triggerSource: run.triggerSource,
          initialSessionStatus: sessionStatus,
          directory: runDirectory,
        })
        return
      }

      await this.finalizeRecoveredRun(job, run, {
        status: 'failed',
        responseText: assistantState?.responseText ?? null,
        errorText: 'This run was interrupted before completion, likely because OpenCode Manager restarted while it was in progress. Open the linked session to inspect the partial output and rerun if needed.',
      }, repo)
    } catch (error) {
      const errorText = getErrorMessage(error)
      logger.error(`Failed to recover schedule ${job.id}:`, error)
      await this.finalizeRecoveredRun(job, run, {
        status: 'failed',
        errorText,
      }, this.assertRepo(job.repoId))
    }
  }

  private async finalizeRecoveredRun(
    job: ScheduleJob,
    run: ScheduleRun,
    input: {
      status: 'completed' | 'failed'
      responseText?: string | null
      errorText?: string | null
    },
    repo: Repo,
  ): Promise<void> {
    const finishedAt = Date.now()

    updateScheduleRun(this.db, run.repoId, run.jobId, run.id, {
      status: input.status,
      finishedAt,
      sessionId: run.sessionId,
      sessionTitle: run.sessionTitle,
      responseText: input.responseText,
      errorText: input.errorText,
      logText: buildRunLog({
        job,
        triggerSource: run.triggerSource,
        sessionId: run.sessionId,
        sessionTitle: run.sessionTitle,
        responseText: input.responseText,
        errorText: input.errorText,
        finishedAt,
      }),
    })

    updateScheduleJobRunState(this.db, run.repoId, run.jobId, {
      lastRunAt: finishedAt,
      nextRunAt: run.triggerSource === 'manual' ? job.nextRunAt : computeNextRunAtForJob(job, finishedAt),
    })

    await this.teardownWorktree(run.repoId, run.jobId, run.id, job, repo)
    ScheduleService.activeRuns.delete(job.id)
  }

  private async teardownWorktree(repoId: number, jobId: number, runId: number, job: ScheduleJob, repo: Repo): Promise<void> {
    const key = `${repoId}:${jobId}:${runId}`
    if (ScheduleService.activeTeardowns.has(key)) return
    ScheduleService.activeTeardowns.add(key)
    try {
      const fresh = getScheduleRunById(this.db, repoId, jobId, runId)
      if (!fresh?.worktreePath) return
      try {
        const { commitHash } = await this.worktreeManager.finalize(repo, job, {
          id: runId,
          worktreePath: fresh.worktreePath,
          runBranch: fresh.runBranch,
          triggerSource: fresh.triggerSource,
          workspaceId: fresh.workspaceId,
        })
        updateScheduleRunWorktree(this.db, repoId, jobId, runId, { worktreePath: null, commitHash, workspaceId: null })
      } catch (error) {
        logger.error(`Failed to finalize worktree for run ${runId}:`, error)
        updateScheduleRunWorktree(this.db, repoId, jobId, runId, { worktreePath: null, workspaceId: null })
      }
    } finally {
      ScheduleService.activeTeardowns.delete(key)
    }
  }

  private async readAssistantOutcome(directory: string, sessionId: string): Promise<AssistantOutcome> {
    const sessionStatus = (await this.getSessionStatuses(directory))[sessionId]
    if (sessionStatus && sessionStatus.type !== 'idle') {
      return { kind: 'busy' }
    }

    const assistantState = getAssistantMessageState(await this.listSessionMessages(directory, sessionId))
    if (assistantState?.completed || assistantState?.errorText) {
      return { kind: 'settled', responseText: assistantState.responseText, errorText: assistantState.errorText }
    }

    return { kind: 'stopped', responseText: assistantState?.responseText ?? null }
  }

  private async readSettledAssistantState(
    directory: string,
    sessionId: string,
  ): Promise<{ responseText: string | null; errorText: string | null } | null> {
    const outcome = await this.readAssistantOutcome(directory, sessionId)
    return outcome.kind === 'settled'
      ? { responseText: outcome.responseText, errorText: outcome.errorText }
      : null
  }

  private async waitForAssistantMessage(
    sessionId: string,
    sessionMonitor: SessionMonitor,
    directory: string,
  ): Promise<{ responseText: string | null; errorText: string | null }> {
    for (;;) {
      const signal = await sessionMonitor.nextSignal()

      if (signal.errorText || signal.disposed) {
        const messages = await this.listSessionMessages(directory, sessionId)
        return {
          responseText: getAssistantMessageState(messages)?.responseText ?? null,
          errorText: signal.errorText ?? SESSION_STOPPED_ERROR,
        }
      }

      const outcome = await this.readAssistantOutcome(directory, sessionId)

      if (outcome.kind === 'busy') {
        continue
      }

      if (outcome.kind === 'settled') {
        return { responseText: outcome.responseText, errorText: outcome.errorText }
      }

      return { responseText: outcome.responseText, errorText: SESSION_STOPPED_ERROR }
    }
  }

  private async listSessionMessages(directory: string, sessionId: string): Promise<SessionMessage[]> {
    const messagesResponse = await this.openCodeClient.forward({
      method: 'GET',
      path: `/session/${sessionId}/message`,
      directory,
    })

    if (!messagesResponse.ok) {
      const errorText = await messagesResponse.text()
      throw new ScheduleServiceError(errorText || 'Failed to fetch session messages', 502)
    }

    return await messagesResponse.json() as SessionMessage[]
  }

  private async getSessionStatuses(directory: string): Promise<Record<string, SessionStatus>> {
    const response = await this.openCodeClient.forward({
      method: 'GET',
      path: '/session/status',
      directory,
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new ScheduleServiceError(errorText || 'Failed to fetch session statuses', 502)
    }

    return await response.json() as Record<string, SessionStatus>
  }

  private assertRepo(repoId: number) {
    if (repoId === ASSISTANT_REPO_ID) {
      const repo = getRepoById(this.db, ASSISTANT_REPO_ID)
      if (repo) return repo
      return { ...buildAssistantRepo(), lastAccessedAt: Date.now(), isLocal: true, currentBranch: undefined }
    }
    const repo = getRepoById(this.db, repoId)
    if (!repo) {
      throw new ScheduleServiceError('Repo not found', 404)
    }
    return repo
  }

  private assertJob(repoId: number, jobId: number) {
    const job = getScheduleJobById(this.db, repoId, jobId)
    if (!job) {
      throw new ScheduleServiceError('Schedule not found', 404)
    }
    return job
  }
}

export { ScheduleServiceError }
