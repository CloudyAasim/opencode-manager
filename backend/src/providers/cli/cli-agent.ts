import type { Message, Session } from '@opencode-manager/shared/api/v1'
import {
  ProviderUnavailableError,
  type AgentCapability,
  type AgentKind,
  type AgentProvider,
  type CreateSessionInput,
  type ListSessionsParams,
  type ProviderContext,
  type ProviderStatus,
  type SendPromptInput,
  type SessionPage,
} from '../contract'
import { findExecutable, runCli, stopChild, type CliEnvironment } from './cli-process'

/**
 * An agent that is a program on this machine rather than a server somewhere
 * else.
 *
 * They differ in almost everything - the name of the program, where it keeps
 * its sessions, what it prints, how it is told to continue an old session -
 * and they agree in one thing that matters here: they leave their history on
 * disk, and the manager can read it back in its own words.
 *
 * So the shape below is the part they agree on, and each agent fills in the
 * five answers it knows.
 */

export interface CliSession {
  /** The id the agent itself knows this session by. */
  id: string
  title: string
  directory: string | null
  createdAt: number
  updatedAt: number
  messages: Message[]
  /** Where the session lives, when it lives in a file. */
  file?: string
}

export interface CliAgentOptions {
  /** The environment the program is looked for in. */
  environment?: CliEnvironment
  /** How long a single run may take. */
  timeoutMs?: number
}

export abstract class CliAgentProvider implements AgentProvider {
  abstract readonly id: string
  abstract readonly label: string
  readonly kind: AgentKind = 'cli'
  readonly capabilities: readonly AgentCapability[] = ['sessions', 'messages', 'prompts', 'abort']

  constructor(protected readonly options: CliAgentOptions = {}) {}
  /** The program this agent runs as. */
  protected abstract readonly binary: string

  /** The sessions this agent has left on the machine. */
  protected abstract readSessions(context: ProviderContext): CliSession[]

  /** The command line that makes the agent work on something. */
  protected abstract command(
    text: string,
    resume: string | undefined,
    context: ProviderContext,
  ): string[]

  /** The id of the session the agent worked in, read out of what it printed. */
  protected abstract readSessionId(output: string): string | null

  /** The file the session lives in, so that a session can be removed. */
  protected abstract sessionFile(sessionId: string, context: ProviderContext): string | null

  async status(): Promise<ProviderStatus> {
    const binary = this.findBinary()
    if (!binary) {
      return { status: 'unavailable', detail: `${this.label} is not installed on this machine` }
    }
    const readiness = await this.readiness()
    if (readiness) return readiness
    return { status: 'ready' }
  }

  /**
   * Whether the agent can do anything at all.
   *
   * A program being on this machine is not the same as the agent being able
   * to work: one of them is installed and the other is signed in. An agent
   * that says it is ready and then cannot answer a prompt is worse than one
   * that says it is not signed in.
   */
  protected async readiness(): Promise<ProviderStatus | null> {
    return null
  }

  async listSessions(context: ProviderContext, _params?: ListSessionsParams): Promise<SessionPage> {
    // A program on this machine keeps its sessions in files, and reading all
    // of them is how it has always worked. There is no cursor to hand back:
    // this list is the last page, and it says so rather than pretending there
    // is more.
    return {
      items: this.readSessions(context).map((session) => toSession(session, this.id, context.directory)),
      nextCursor: null,
    }
  }

  async getSession(id: string, context: ProviderContext): Promise<Session | null> {
    const found = this.readSessions(context).find((session) => session.id === id)
    return found ? toSession(found, this.id, context.directory) : null
  }

  async listMessages(sessionId: string, context: ProviderContext): Promise<Message[]> {
    const found = this.readSessions(context).find((session) => session.id === sessionId)
    return found?.messages ?? []
  }

  /**
   * A program that is not installed cannot be given a session, and pretending
   * otherwise would leave the caller with an id that no program will ever
   * recognise.
   */
  async createSession(input: CreateSessionInput): Promise<Session> {
    const session = await this.run(input.title ?? '', undefined, { directory: input.directory })
    if (!session) {
      throw new ProviderUnavailableError(this.id, `${this.label} did not report a session`)
    }
    return toSession(session, this.id)
  }

  async sendPrompt(sessionId: string, input: SendPromptInput, context: ProviderContext): Promise<void> {
    await this.run(input.text, sessionId, context)
  }

  /**
   * A CLI agent names its own sessions, and most of them cannot be told to
   * use another name. Saying so is better than a rename that quietly does
   * nothing.
   */
  async renameSession(_id: string, _title: string, _context: ProviderContext): Promise<Session> {
    throw new ProviderUnavailableError(this.id, `${this.label} cannot rename a session`)
  }

  async deleteSession(id: string, context: ProviderContext): Promise<void> {
    const file = this.sessionFile(id, context)
    if (!file) {
      throw new ProviderUnavailableError(this.id, `${this.label} has no session ${id} on this machine`)
    }
    const { unlink } = await import('node:fs/promises')
    await unlink(file)
  }

  async abortSession(_id: string, _context: ProviderContext): Promise<void> {
    if (!this.running) {
      throw new ProviderUnavailableError(this.id, `${this.label} is not running anything right now`)
    }
    stopChild(this.running)
    this.running = null
  }

  protected running: import('node:child_process').ChildProcess | null = null

  protected findBinary(): string | null {
    return findExecutable(this.binary, this.options.environment)
  }

  /**
   * Run the program and wait for it to finish. The session it worked in is
   * read out of what it printed; a program that prints nothing readable is a
   * program that did not do what was asked.
   */
  protected async run(
    text: string,
    resume: string | undefined,
    context: ProviderContext,
  ): Promise<CliSession | null> {
    const binary = this.findBinary()
    if (!binary) {
      throw new ProviderUnavailableError(this.id, `${this.label} is not installed on this machine`)
    }

    const args = this.command(text, resume, context)
    const result = await runCli(binary, args, {
      cwd: context.directory,
      timeoutMs: this.options.timeoutMs,
      env: this.options.environment,
      onSpawn: (child) => {
        this.running = child
      },
    })
    this.running = null

    const sessionId = this.readSessionId(result.stdout)
    if (!sessionId) return null

    const sessions = this.readSessions(context)
    const found = sessions.find((session) => session.id === sessionId)
    if (found) return found

    return {
      id: sessionId,
      title: firstLine(text),
      directory: context.directory ?? null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      messages: [],
    }
  }
}

function toSession(session: CliSession, agentId: string, fallbackDirectory?: string): Session {
  return {
    id: session.id,
    agentId,
    title: session.title,
    // The directory the session was worked on, or the one it was asked about.
    // A file on disk does not always say where it was written, and a session
    // with no place belongs to nobody.
    directory: session.directory ?? fallbackDirectory ?? null,
    // A program on this machine has no working areas beyond the directory it
    // was run in, and it says so rather than inventing one.
    workspaceId: null,
    parentId: null,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    archived: false,
    status: 'idle',
  }
}

export function firstLine(text: string): string {
  const line = text.split(/\r?\n/).find((entry) => entry.trim().length > 0)
  return line ? line.trim() : ''
}
