import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { Message, MessagePart } from '@opencode-manager/shared/api/v1'
import { CliAgentProvider, type CliSession } from './cli-agent'
import { jsonlLines, runCli } from './cli-process'
import type { ProviderStatus } from '../contract'

/**
 * Claude Code, as a program on this machine.
 *
 * Two things about it are worth writing down.
 *
 * The first is how it is driven: `claude -p "<text>" --output-format json`
 * runs one turn and prints one JSON object, and the session it worked in is
 * named in it. There is no `--cwd`, so the working directory is the one the
 * process was started in - which is the one the manager wanted anyway.
 *
 * The second is where its sessions are, and how careful one has to be about
 * them. Claude Code keeps one JSONL file per session under
 * `~/.claude/projects/<project>/`, and the official documentation says the
 * line format is internal to Claude Code and changes between versions.
 * So the reading here is deliberately forgiving: a line that is not
 * understood is skipped rather than guessed at, and a session whose file
 * cannot be read is not shown rather than shown wrong.
 */

interface ClaudeLine {
  type?: string
  uuid?: string
  sessionId?: string
  cwd?: string
  timestamp?: string
  isMeta?: boolean
  message?: {
    role?: string
    content?: unknown
  }
}

interface ClaudeBlock {
  type?: string
  text?: string
  thinking?: string
  id?: string
  name?: string
  tool_use_id?: string
  content?: unknown
  is_error?: boolean
}

export class ClaudeCodeProvider extends CliAgentProvider {
  readonly id = 'claude-code'
  readonly label = 'Claude Code'
  protected readonly binary = 'claude'

  protected command(text: string, resume: string | undefined): string[] {
    const args = ['-p', text, '--output-format', 'json']
    if (resume) args.push('--resume', resume)
    return args
  }

  protected readSessionId(output: string): string | null {
    for (const record of jsonlLines(output)) {
      const sessionId = (record as { session_id?: unknown }).session_id
      if (typeof sessionId === 'string' && sessionId) return sessionId
    }
    return null
  }

  /**
   * Claude Code knows whether it is signed in, and says so in one command.
   * A program on the machine is not the same as an agent that can work.
   */
  protected override async readiness(): Promise<ProviderStatus | null> {
    const binary = this.findBinary()
    if (!binary) return null

    const result = await runCli(binary, ['auth', 'status'], { timeoutMs: 20_000 })
    const json = firstJsonObject(result.stdout)
    if (!json) return null

    if (json.loggedIn === true) return { status: 'ready' }
    return {
      status: 'unavailable',
      detail: 'Claude Code is installed but not signed in; run "claude" and then /login',
    }
  }

  protected readSessions(): CliSession[] {
    const root = this.projectsRoot()
    if (!fs.existsSync(root)) return []

    const sessions: CliSession[] = []
    for (const project of fs.readdirSync(root, { withFileTypes: true })) {
      if (!project.isDirectory()) continue
      const directory = path.join(root, project.name)
      for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        if (!entry.isFile() || !entry.name.endsWith('.jsonl')) continue
        const file = path.join(directory, entry.name)
        const session = readClaudeSession(file, entry.name.replace(/\.jsonl$/, ''))
        if (session) sessions.push(session)
      }
    }
    return sessions
  }

  protected sessionFile(sessionId: string): string | null {
    const root = this.projectsRoot()
    if (!fs.existsSync(root)) return null
    for (const project of fs.readdirSync(root, { withFileTypes: true })) {
      if (!project.isDirectory()) continue
      const candidate = path.join(root, project.name, `${sessionId}.jsonl`)
      if (fs.existsSync(candidate)) return candidate
    }
    return null
  }

  private projectsRoot(): string {
    const configDirectory = process.env.CLAUDE_CONFIG_DIR
    const base = configDirectory ?? path.join(os.homedir(), '.claude')
    return path.join(base, 'projects')
  }
}

export function readClaudeSession(file: string, fallbackId: string): CliSession | null {
  let raw: string
  try {
    raw = fs.readFileSync(file, 'utf8')
  } catch {
    return null
  }

  const records = jsonlLines(raw) as ClaudeLine[]
  if (records.length === 0) return null

  const messages = toClaudeMessages(records)
  // The first lines of a transcript are bookkeeping - the mode, the
  // permission mode, a snapshot of the files - and only the messages
  // themselves say where the session was.
  const withDirectory = records.find((record) => typeof record.cwd === 'string')
  const withSession = records.find((record) => typeof record.sessionId === 'string')
  const stats = fs.statSync(file)

  return {
    id: withSession?.sessionId ?? fallbackId,
    title: titleOf(messages),
    directory: withDirectory?.cwd ?? null,
    createdAt: stats.birthtimeMs || stats.mtimeMs,
    updatedAt: stats.mtimeMs,
    messages,
    file,
  }
}

/**
 * The messages of a session, in the words the manager uses. A tool call and
 * the result that answers it are two lines in Claude Code's file and one part
 * here, because a call without its result says only that something was
 * attempted.
 */
export function toClaudeMessages(records: ClaudeLine[]): Message[] {
  const messages: Message[] = []
  const toolParts = new Map<string, MessagePart>()

  for (const record of records) {
    if (record.type !== 'user' && record.type !== 'assistant') continue
    const content = record.message?.content
    const timestamp = record.timestamp ? Date.parse(record.timestamp) : 0
    const id = record.uuid ?? ''

    if (typeof content === 'string') {
      // Claude Code writes its own bookkeeping into the transcript as user
      // messages: the caveat that a slash command was run locally, the
      // command itself, and what it printed. None of that was said to the
      // agent, so none of it belongs in the conversation.
      if (record.isMeta || isLocalCommand(content)) continue
      messages.push({
        id,
        sessionId: record.sessionId ?? '',
        role: record.type === 'user' ? 'user' : 'assistant',
        createdAt: timestamp,
        completedAt: null,
        parts: [{ id, type: 'text', text: content, tool: null }],
        cost: null,
        tokens: null,
      })
      continue
    }

    if (!Array.isArray(content)) continue

    if (record.type === 'user') {
      for (const block of content as ClaudeBlock[]) {
        if (block?.type !== 'tool_result') continue
        const part = toolParts.get(block.tool_use_id ?? '')
        if (!part?.tool) continue
        part.tool.state = block.is_error ? 'error' : 'completed'
        part.tool.output = textOf(block.content)
      }
      continue
    }

    const parts: MessagePart[] = []
    for (const [index, block] of (content as ClaudeBlock[]).entries()) {
      if (block?.type === 'text') {
        parts.push({ id: `${id}-${index}`, type: 'text', text: block.text ?? '', tool: null })
      } else if (block?.type === 'thinking') {
        parts.push({ id: `${id}-${index}`, type: 'reasoning', text: block.thinking ?? '', tool: null })
      } else if (block?.type === 'tool_use') {
        const part: MessagePart = {
          id: block.id ?? `${id}-${index}`,
          type: 'tool',
          text: null,
          tool: { name: block.name ?? '', state: 'running', title: null, output: null },
        }
        parts.push(part)
        toolParts.set(block.id ?? '', part)
      }
    }

    messages.push({
      id,
      sessionId: record.sessionId ?? '',
      role: 'assistant',
      createdAt: timestamp,
      completedAt: null,
      parts,
      cost: null,
      tokens: null,
    })
  }

  return messages
}

function titleOf(messages: Message[]): string {
  const firstUser = messages.find((message) => message.role === 'user')
  const text = firstUser?.parts.find((part) => part.type === 'text')?.text ?? ''
  const line = text.split(/\r?\n/).find((entry) => entry.trim().length > 0)
  return line ? line.trim() : ''
}

/**
 * The wrappers Claude Code puts around a command that was run locally
 * rather than said to the agent.
 */
export function isLocalCommand(content: string): boolean {
  const trimmed = content.trim()
  return trimmed.startsWith('<command-') || trimmed.startsWith('<local-command-')
}

/**
 * The first JSON object in a program's output. A program that prints a
 * banner before its answer still has an answer in it.
 */
export function firstJsonObject(output: string): Record<string, unknown> | null {
  const start = output.indexOf('{')
  if (start < 0) return null
  const end = output.lastIndexOf('}')
  if (end <= start) return null
  try {
    const parsed = JSON.parse(output.slice(start, end + 1)) as unknown
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : null
  } catch {
    return null
  }
}

function textOf(content: unknown): string | null {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return null
  const parts = content as ClaudeBlock[]
  const texts = parts
    .filter((block) => block?.type === 'text')
    .map((block) => block.text ?? '')
    .filter((entry) => entry.length > 0)
  return texts.length > 0 ? texts.join('\n') : null
}
