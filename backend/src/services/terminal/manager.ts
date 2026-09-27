import type { Database } from 'bun:sqlite'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { ENV } from '@opencode-manager/shared/config/env'
import { logger } from '../../utils/logger'
import { createPtySpawner, type PtySpawner } from './pty'
import { TerminalSession } from './session'
import { isInsideDirectory, resolveUserTerminalHome } from './home'

export type TerminalErrorCode =
  | 'TERMINAL_DISABLED'
  | 'TERMINAL_UNAVAILABLE'
  | 'TOO_MANY_SESSIONS'
  | 'SESSION_NOT_FOUND'
  | 'FORBIDDEN'

export class TerminalError extends Error {
  constructor(public readonly code: TerminalErrorCode) {
    super(code)
  }
}

export interface TerminalActor {
  id: string
  email: string
  username: string | null
  role?: 'admin' | 'user'
  ipAddress: string | null
  userAgent: string | null
}

export interface TerminalSessionSummary {
  id: string
  userId: string
  userEmail: string
  shell: string
  cwd: string
  cols: number
  rows: number
  createdAt: number
  lastActivityAt: number
  exited: boolean
  exitCode: number | null
  closeReason: string
  totalBytes: number
}

export interface TerminalRuntimeConfig {
  enabled: boolean
  available: boolean
  shell: string
  cwd: string
  cols: number
  rows: number
  idleTimeoutMs: number
  maxDurationMs: number
  maxSessionsPerUser: number
  adminsOnly: boolean
  perUserHome: boolean
}

const SWEEP_INTERVAL_MS = 30_000

export class TerminalManager {
  private readonly sessions = new Map<string, TerminalSession>()
  private readonly spawner: PtySpawner
  private sweeper: ReturnType<typeof setInterval> | undefined

  constructor(
    private readonly db: Database,
    spawner: PtySpawner = createPtySpawner(),
  ) {
    this.spawner = spawner
  }

  getConfig(): TerminalRuntimeConfig {
    return {
      enabled: ENV.TERMINAL.ENABLED,
      available: this.isAvailable(),
      shell: ENV.TERMINAL.SHELL,
      cwd: ENV.TERMINAL.CWD,
      cols: ENV.TERMINAL.COLS,
      rows: ENV.TERMINAL.ROWS,
      idleTimeoutMs: ENV.TERMINAL.IDLE_TIMEOUT_MS,
      maxDurationMs: ENV.TERMINAL.MAX_DURATION_MS,
      maxSessionsPerUser: ENV.TERMINAL.MAX_SESSIONS_PER_USER,
      adminsOnly: ENV.TERMINAL.ADMINS_ONLY,
      perUserHome: ENV.TERMINAL.PER_USER_HOME,
    }
  }

  isEnabled(): boolean {
    return ENV.TERMINAL.ENABLED
  }

  isAvailable(): boolean {
    return this.isEnabled() && this.spawner.available()
  }

  start(): void {
    if (this.sweeper) return
    this.sweeper = setInterval(() => this.sweep(), SWEEP_INTERVAL_MS)
    this.sweeper.unref?.()
  }

  shutdown(): void {
    if (this.sweeper) {
      clearInterval(this.sweeper)
      this.sweeper = undefined
    }
    for (const session of this.sessions.values()) {
      if (!session.isExited) {
        this.auditEnd(session, null, 'shutdown')
      }
      session.dispose()
    }
    this.sessions.clear()
  }

  list(actor: TerminalActor): TerminalSessionSummary[] {
    return [...this.sessions.values()]
      .filter((session) => session.userId === actor.id)
      .map((session) => this.toSummary(session))
  }

  create(actor: TerminalActor, options: { cols?: number; rows?: number; cwd?: string }): TerminalSession {
    if (!this.isEnabled()) throw new TerminalError('TERMINAL_DISABLED')
    if (!this.spawner.available()) throw new TerminalError('TERMINAL_UNAVAILABLE')

    const userSessions = [...this.sessions.values()].filter((session) => session.userId === actor.id)
    if (userSessions.length >= ENV.TERMINAL.MAX_SESSIONS_PER_USER) {
      throw new TerminalError('TOO_MANY_SESSIONS')
    }
    if (this.sessions.size >= ENV.TERMINAL.MAX_SESSIONS_TOTAL) {
      throw new TerminalError('TOO_MANY_SESSIONS')
    }

    const cols = clampDimension(options.cols, ENV.TERMINAL.COLS)
    const rows = clampDimension(options.rows, ENV.TERMINAL.ROWS)
    const id = randomUUID()
    const home = resolveUserTerminalHome(actor.id, actor.username)
    const allowedRoot = actor.role === 'admin' ? path.resolve(ENV.TERMINAL.CWD) : home
    const requestedCwd = options.cwd ? path.resolve(options.cwd) : null
    const cwd = requestedCwd && isInsideDirectory(allowedRoot, requestedCwd) ? requestedCwd : home
    const isolateWorkspace = ENV.TERMINAL.ISOLATE && actor.role !== 'admin' ? home : undefined
    const sandboxCwd = isolateWorkspace
      ? path.posix.join('/workspace', path.relative(home, cwd).split(path.sep).join('/'))
      : undefined

    const pty = this.spawner.spawn({
      shell: ENV.TERMINAL.SHELL,
      cwd,
      cols,
      rows,
      isolateWorkspace,
      sandboxCwd,
    })

    const session = new TerminalSession(
      {
        id,
        userId: actor.id,
        userEmail: actor.email,
        ipAddress: actor.ipAddress,
        userAgent: actor.userAgent,
        shell: ENV.TERMINAL.SHELL,
        cwd,
        cols,
        rows,
      },
      pty,
    )

    this.sessions.set(id, session)
    this.auditStart(session)
    session.onExit((exit) => {
      this.auditEnd(session, exit.code, exit.reason)
      this.sessions.delete(session.id)
    })
    logger.info(`Terminal session ${id} opened by ${actor.email}`)
    return session
  }

  get(id: string, actor: TerminalActor): TerminalSession {
    const session = this.sessions.get(id)
    if (!session) throw new TerminalError('SESSION_NOT_FOUND')
    if (session.userId !== actor.id) throw new TerminalError('FORBIDDEN')
    return session
  }

  close(id: string, actor: TerminalActor, reason = 'user-closed'): void {
    const session = this.get(id, actor)
    session.close(reason)
  }

  closeAllForUser(userId: string, reason = 'session-revoked'): void {
    for (const session of this.sessions.values()) {
      if (session.userId === userId) session.close(reason)
    }
  }

  private sweep(): void {
    const now = Date.now()
    for (const session of [...this.sessions.values()]) {
      if (session.isExited) {
        this.sessions.delete(session.id)
        continue
      }
      if (now - session.lastActivityAt > ENV.TERMINAL.IDLE_TIMEOUT_MS) {
        logger.info(`Terminal session ${session.id} closed: idle timeout`)
        session.close('idle-timeout')
        continue
      }
      if (now - session.createdAt > ENV.TERMINAL.MAX_DURATION_MS) {
        logger.info(`Terminal session ${session.id} closed: max duration reached`)
        session.close('max-duration')
      }
    }
  }

  private toSummary(session: TerminalSession): TerminalSessionSummary {
    const { cols, rows } = session.dimensions
    const { totalBytes } = session.stats
    const exit = session.exit
    return {
      id: session.id,
      userId: session.userId,
      userEmail: session.userEmail,
      shell: session.shell,
      cwd: session.cwd,
      cols,
      rows,
      createdAt: session.createdAt,
      lastActivityAt: session.lastActivityAt,
      exited: session.isExited,
      exitCode: exit.code,
      closeReason: exit.reason,
      totalBytes,
    }
  }

  private auditStart(session: TerminalSession): void {
    try {
      const { cols, rows } = session.dimensions
      this.db
        .prepare(
          `INSERT INTO terminal_audit
            (id, user_id, user_email, ip_address, user_agent, shell, cwd, cols, rows, started_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          session.id,
          session.userId,
          session.userEmail,
          session.ipAddress,
          session.userAgent,
          session.shell,
          session.cwd,
          cols,
          rows,
          session.createdAt,
        )
    } catch (error) {
      logger.error('Failed to write terminal audit start', error)
    }
  }

  private auditEnd(session: TerminalSession, exitCode: number | null, reason: string): void {
    try {
      const { totalBytes } = session.stats
      this.db
        .prepare(
          `UPDATE terminal_audit
             SET ended_at = ?, exit_code = ?, close_reason = ?, total_bytes = ?
           WHERE id = ?`,
        )
        .run(Date.now(), exitCode, reason, totalBytes, session.id)
    } catch (error) {
      logger.error('Failed to write terminal audit end', error)
    }
  }
}

function clampDimension(value: number | undefined, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.max(20, Math.min(Math.floor(value), 500))
}
