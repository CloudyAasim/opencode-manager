import { logger } from '../utils/logger'
import type { OpenCodeClient } from './opencode/client'

export interface ActiveSessionsProvider {
  getActiveSessions(): Record<string, string[]>
  isSubagentSession(sessionId: string): boolean
  getScheduledSessionIds(): Set<string>
}

export interface ResumableSession {
  sessionID: string
  directory: string
}

export interface RestartWithResumeResult {
  healthy: boolean
  resumedSessionIDs: string[]
}

export class OpenCodeRestartCoordinator {
  // Restart-with-resume has to be atomic as a whole. `OpenCodeSupervisor`
  // serialises the restart itself, but capture/abort happens *before* it and
  // resume *after* it, so two overlapping calls used to interleave into
  //
  //   abort s1 -> abort s1 -> restart -> restart -> resume s1 -> resume s1
  //
  // (observed, not schematic). The second restart lands immediately after the
  // first, killing whatever the first had just resumed, and s1 then receives
  // *two* "continue" prompts - so the session does its work twice. Two requests
  // overlap easily: a double-clicked restart, or `/opencode-upgrade` racing
  // `/opencode-restart`; both funnel through here.
  //
  // Same chaining idiom as `OpenCodeSupervisor.runLifecycleOperation`. The tail
  // swallows failures so one failed restart does not poison every later one.
  private operationTail: Promise<unknown> = Promise.resolve()

  constructor(
    private readonly client: OpenCodeClient,
    private readonly activeSessions: ActiveSessionsProvider,
  ) {}

  captureResumableSessions(): ResumableSession[] {
    const active = this.activeSessions.getActiveSessions()
    const scheduled = this.activeSessions.getScheduledSessionIds()
    const sessions: ResumableSession[] = []

    for (const [directory, sessionIDs] of Object.entries(active)) {
      for (const sessionID of sessionIDs) {
        if (!this.activeSessions.isSubagentSession(sessionID) && !scheduled.has(sessionID)) {
          sessions.push({ sessionID, directory })
        }
      }
    }

    return sessions
  }

  async abortSessions(sessions: ResumableSession[]): Promise<void> {
    await Promise.allSettled(
      sessions.map(async (s) => {
        try {
          await this.client.forward({
            method: 'POST',
            path: `/session/${s.sessionID}/abort`,
            directory: s.directory,
          })
        } catch (error) {
          logger.warn(`Failed to abort session ${s.sessionID}: ${error}`)
        }
      }),
    )
  }

  async resumeSessions(sessions: ResumableSession[]): Promise<string[]> {
    const results = await Promise.allSettled(
      sessions.map(async (s) => {
        try {
          const response = await this.client.forward({
            method: 'POST',
            path: `/session/${s.sessionID}/prompt_async`,
            directory: s.directory,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ parts: [{ type: 'text', text: 'continue' }] }),
          })
          return response.ok ? s.sessionID : null
        } catch (error) {
          logger.warn(`Failed to resume session ${s.sessionID}: ${error}`)
          return null
        }
      }),
    )

    return results
      .map((result) => (result.status === 'fulfilled' ? result.value : null))
      .filter((sessionID): sessionID is string => sessionID !== null)
  }

  async runWithResume(restart: () => Promise<boolean>): Promise<RestartWithResumeResult> {
    const run = this.operationTail.then(
      () => this.runWithResumeNow(restart),
      () => this.runWithResumeNow(restart),
    )
    this.operationTail = run.catch(() => undefined)
    return run
  }

  private async runWithResumeNow(restart: () => Promise<boolean>): Promise<RestartWithResumeResult> {
    const sessions = this.captureResumableSessions()
    await this.abortSessions(sessions)
    const healthy = await restart()
    const resumedSessionIDs = healthy ? await this.resumeSessions(sessions) : []
    return { healthy, resumedSessionIDs }
  }
}
