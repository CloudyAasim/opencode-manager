import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type {
  Message,
  MessagePart,
  MessageWithParts,
  ToolMessagePart,
} from '@opencode-manager/shared/api/v1'
import { CliAgentProvider, type CliSession } from './cli-agent'
import { jsonlLines } from './cli-process'
import type { ProviderStatus } from '../contract'

/**
 * Pi, as a program on this machine.
 *
 * Pi keeps its sessions in one JSONL file per session, and that file is not
 * a flat conversation: every entry names its parent, so a session is a tree
 * and the branch that is alive is the one that ends at the newest entry.
 * Reading the file in order would show work that was abandoned half way
 * through, so the branch is picked out first and only then read.
 *
 * The format is versioned and documented, which is why this one is read
 * rather than talked to: `pi --mode json` speaks the same events the file
 * holds, and the file is where the history lives between runs.
 */

interface PiEntry {
  type?: string
  id?: string
  parentId?: string | null
  timestamp?: string
  cwd?: string
  message?: PiMessage
}

interface PiMessage {
  role?: string
  content?: unknown
  toolCallId?: string
  toolName?: string
  isError?: boolean
  timestamp?: number
  usage?: PiUsage
}

interface PiUsage {
  input?: number
  output?: number
  cacheRead?: number
  cacheWrite?: number
  reasoning?: number
}

interface PiBlock {
  type?: string
  text?: string
  thinking?: string
  id?: string
  name?: string
  arguments?: unknown
}

export class PiProvider extends CliAgentProvider {
  readonly id = 'pi'
  readonly label = 'Pi'
  protected readonly binary = 'pi'

  protected command(text: string, resume: string | undefined): string[] {
    // `--session-id` is the one that keeps the session in the directory the
    // work is happening in; `--session` would carry it back to wherever it
    // was made.
    if (resume) return ['-p', text, '--session-id', resume]
    return ['--mode', 'json', text]
  }

  /**
   * Pi keeps the credentials it has in one file. An empty one means the
   * agent has no provider, and a provider with no credentials means it
   * cannot answer either.
   */
  protected override async readiness(): Promise<ProviderStatus | null> {
    const auth = this.authFile()
    if (!fs.existsSync(auth)) {
      return {
        status: 'unavailable',
        detail: 'Pi has no provider credentials on this machine; run "pi" and then /login',
      }
    }
    try {
      const parsed = JSON.parse(fs.readFileSync(auth, 'utf8')) as unknown
      const providers = Object.keys(
        typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : {},
      )
      if (providers.length === 0) {
        return {
          status: 'unavailable',
          detail: 'Pi has no provider credentials on this machine; run "pi" and then /login',
        }
      }
    } catch {
      return {
        status: 'unavailable',
        detail: 'Pi has a credentials file that could not be read',
      }
    }
    return { status: 'ready' }
  }

  protected readSessionId(output: string): string | null {
    for (const record of jsonlLines(output)) {
      const entry = record as PiEntry
      if (entry.type === 'session' && typeof entry.id === 'string' && entry.id) return entry.id
    }
    return null
  }

  protected readSessions(): CliSession[] {
    const root = this.sessionsRoot()
    if (!fs.existsSync(root)) return []

    const sessions: CliSession[] = []
    for (const project of fs.readdirSync(root, { withFileTypes: true })) {
      if (!project.isDirectory()) continue
      const directory = path.join(root, project.name)
      for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        if (!entry.isFile() || !entry.name.endsWith('.jsonl')) continue
        const session = readPiSession(path.join(directory, entry.name))
        if (session) sessions.push(session)
      }
    }
    return sessions
  }

  protected sessionFile(sessionId: string): string | null {
    const root = this.sessionsRoot()
    if (!fs.existsSync(root)) return null
    for (const project of fs.readdirSync(root, { withFileTypes: true })) {
      if (!project.isDirectory()) continue
      const directory = path.join(root, project.name)
      for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        if (!entry.isFile() || !entry.name.endsWith('.jsonl')) continue
        const file = path.join(directory, entry.name)
        const session = readPiSession(file)
        if (session?.id === sessionId) return file
      }
    }
    return null
  }

  private sessionsRoot(): string {
    const override = process.env.PI_CODING_AGENT_SESSION_DIR
    if (override) return override
    return path.join(this.agentRoot(), 'sessions')
  }

  private authFile(): string {
    return path.join(this.agentRoot(), 'auth.json')
  }

  private agentRoot(): string {
    const override = process.env.PI_CODING_AGENT_DIR
    if (override) return override
    return path.join(os.homedir(), '.pi', 'agent')
  }
}

export function readPiSession(file: string): CliSession | null {
  let raw: string
  try {
    raw = fs.readFileSync(file, 'utf8')
  } catch {
    return null
  }

  const entries = jsonlLines(raw) as PiEntry[]
  if (entries.length === 0) return null

  const header = entries.find((entry) => entry.type === 'session')
  const branch = activeBranch(entries)
  const messages = toPiMessages(branch)
  const stats = fs.statSync(file)

  return {
    id: header?.id ?? fileNameOf(file),
    title: titleOf(messages, header),
    directory: header?.cwd ?? null,
    createdAt: stats.birthtimeMs || stats.mtimeMs,
    updatedAt: stats.mtimeMs,
    messages,
    file,
  }
}

/**
 * The branch that is alive: the entry that ends it, followed back through
 * its parents to the first one, then the other way round so that it reads
 * in the order it happened.
 */
export function activeBranch(entries: PiEntry[]): PiEntry[] {
  const withIds = entries.filter((entry) => typeof entry.id === 'string' && entry.id)
  if (withIds.length === 0) return []

  const parents = new Set(
    withIds.map((entry) => entry.parentId).filter((id): id is string => typeof id === 'string'),
  )

  let leaf = withIds[withIds.length - 1]!
  for (let index = withIds.length - 1; index >= 0; index -= 1) {
    const candidate = withIds[index]!
    if (!parents.has(candidate.id!)) {
      leaf = candidate
      break
    }
  }

  const byId = new Map(withIds.map((entry) => [entry.id!, entry]))
  const chain: PiEntry[] = []
  let current: PiEntry | undefined = leaf
  while (current) {
    chain.push(current)
    const parentId: string | undefined | null = current.parentId
    current = parentId ? byId.get(parentId) : undefined
  }
  return chain.reverse()
}

export function toPiMessages(entries: PiEntry[]): MessageWithParts[] {
  const messages: MessageWithParts[] = []
  const toolParts = new Map<string, ToolMessagePart>()

  for (const entry of entries) {
    if (entry.type !== 'message') continue
    const message = entry.message
    if (!message) continue

    const id = entry.id ?? ''
    const createdAt = message.timestamp ?? (entry.timestamp ? Date.parse(entry.timestamp) : 0)
    const role = message.role

    if (role === 'toolResult') {
      const part = toolParts.get(message.toolCallId ?? '')
      if (part) {
        part.state.status = message.isError ? 'error' : 'completed'
        part.state.output = textOf(message.content)
      }
      continue
    }

    if (role !== 'user' && role !== 'assistant') continue

    const parts: MessagePart[] = []
    if (typeof message.content === 'string') {
      parts.push({ id, type: 'text', text: message.content, synthetic: null, time: null })
    } else if (Array.isArray(message.content)) {
      for (const [index, block] of (message.content as PiBlock[]).entries()) {
        if (block?.type === 'text') {
          parts.push({ id: `${id}-${index}`, type: 'text', text: block.text ?? '', synthetic: null, time: null })
        } else if (block?.type === 'thinking') {
          parts.push({ id: `${id}-${index}`, type: 'reasoning', text: block.thinking ?? '', time: null })
        } else if (block?.type === 'toolCall') {
          const part: ToolMessagePart = {
            id: block.id ?? `${id}-${index}`,
            type: 'tool',
            callId: block.id ?? '',
            name: block.name ?? '',
            state: {
              status: 'running',
              title: null,
              output: null,
              error: null,
              input: null,
              metadata: null,
              raw: null,
              time: null,
            },
          }
          parts.push(part)
          toolParts.set(block.id ?? '', part)
        }
      }
    }

    messages.push({
      info: toInfo(id, role, createdAt, message.usage),
      parts,
    })
  }

  return messages
}

/**
 * What Pi says about a message, without the pieces of it.
 *
 * Pi counts the tokens of an answer, so those are carried over. It says
 * nothing about what the answer cost or which model gave it, and saying so
 * with null is truer than making a number up.
 */
function toInfo(
  id: string,
  role: Message['role'],
  createdAt: number,
  usage: PiUsage | undefined,
): Message {
  return {
    id,
    // The file knows which session it belongs to, and the message inside it
    // does not; the reader of the file is the one that knows.
    sessionId: '',
    role,
    createdAt,
    completedAt: null,
    cost: null,
    tokens: usage
      ? {
          input: usage.input ?? 0,
          output: usage.output ?? 0,
          reasoning: usage.reasoning ?? 0,
          cacheRead: usage.cacheRead ?? 0,
          cacheWrite: usage.cacheWrite ?? 0,
        }
      : null,
    modelId: null,
    providerId: null,
    agent: null,
    variant: null,
    parentId: null,
    error: null,
  }
}

function titleOf(messages: MessageWithParts[], header: PiEntry | undefined): string {
  const firstUser = messages.find((message) => message.info.role === 'user')
  const text = firstUser?.parts.find((part) => part.type === 'text')?.text ?? ''
  const line = text.split(/\r?\n/).find((entry) => entry.trim().length > 0)
  if (line) return line.trim()
  return header?.id ?? ''
}

function fileNameOf(file: string): string {
  return path.basename(file).replace(/\.jsonl$/, '')
}

function textOf(content: unknown): string | null {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return null
  const texts = (content as PiBlock[])
    .filter((block) => block?.type === 'text')
    .map((block) => block.text ?? '')
    .filter((entry) => entry.length > 0)
  return texts.length > 0 ? texts.join('\n') : null
}
