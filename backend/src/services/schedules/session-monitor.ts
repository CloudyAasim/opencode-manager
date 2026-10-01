import { type ScheduleJob, type ScheduleRunTriggerSource } from '@opencode-manager/shared/types'
import type { OpenCodeClient } from '../opencode/client'
import { sseAggregator, type SSEEvent } from '../sse-aggregator'
import { logger } from '../../utils/logger'

export interface SessionResponse {
  id: string
}

export interface SessionMessagePart {
  type?: string
  text?: string
}

export interface SessionMessage {
  info?: {
    id?: string
    sessionID?: string
    role?: string
    time?: {
      created?: number
      completed?: number
    }
    error?: {
      name?: string
      data?: {
        message?: string
      }
    }
  }
  parts?: SessionMessagePart[]
}

export interface SessionStatus {
  type: 'idle' | 'retry' | 'busy'
  attempt?: number
  message?: string
  next?: number
}

export const SESSION_STOPPED_ERROR = 'The session stopped without producing an assistant response. This usually means OpenCode restarted mid-run or the session was interrupted. Open the linked session to inspect any partial output and rerun if needed.'

export interface SessionSignal {
  errorText: string | null
  disposed: boolean
}

export interface SessionMonitor {
  markSubmitted(): void
  nextSignal(): Promise<SessionSignal>
  dispose(): void
}

export type AssistantOutcome =
  | { kind: 'busy' }
  | { kind: 'settled'; responseText: string | null; errorText: string | null }
  | { kind: 'stopped'; responseText: string | null }

export function buildSessionTitle(job: ScheduleJob): string {
  return `Scheduled: ${job.name}`
}

export type SkillInfo = {
  name: string
  description: string
  location: string
  content: string
}

export async function fetchSkillContent(slugs: string[], repoPath: string, openCodeClient: OpenCodeClient): Promise<string[]> {
  try {
    const response = await openCodeClient.forward({
      method: 'GET',
      path: '/skill',
      directory: repoPath,
    })
    if (!response.ok) {
      logger.warn(`Failed to fetch skills from OpenCode (${response.status}), falling back to name-only injection`)
      return []
    }
    const skills = await response.json() as SkillInfo[]
    
    const skillBlocks = slugs
      .map((slug) => {
        const skill = skills.find((s) => s.name === slug || s.name.endsWith(`/${slug}`) || s.name.endsWith(`-${slug}`))
        if (!skill) {
          logger.warn(`Skill "${slug}" not found in OpenCode skill list`)
          return null
        }
        return [
          `<skill_content name="${skill.name}">`,
          `# Skill: ${skill.name}`,
          '',
          skill.content.trim(),
          '</skill_content>',
        ].join('\n')
      })
      .filter((block): block is string => block !== null)
    
    const foundCount = skillBlocks.length
    if (foundCount < slugs.length) {
      logger.warn(`Only ${foundCount} of ${slugs.length} requested skills were found`)
    }
    
    return skillBlocks
  } catch (error) {
    logger.warn('Error fetching skills from OpenCode, falling back to name-only injection:', error)
    return []
  }
}

export async function buildPromptWithSkills(
  prompt: string,
  skillMetadata: ScheduleJob['skillMetadata'],
  repoPath: string,
  openCodeClient: OpenCodeClient,
): Promise<string> {
  if (!skillMetadata || !skillMetadata.skillSlugs || skillMetadata.skillSlugs.length === 0) return prompt

  const skillBlocks = await fetchSkillContent(skillMetadata.skillSlugs, repoPath, openCodeClient)
  const notesLine = skillMetadata.notes ? `\nSkill notes: ${skillMetadata.notes}` : ''

  if (skillBlocks.length === 0) {
    const skillList = skillMetadata.skillSlugs.join(', ')
    return `${prompt}\n\nFor this task, use the following skills: ${skillList}${notesLine}`
  }

  return `${prompt}\n\nThe following skills have been loaded for this task:\n\n${skillBlocks.join('\n\n')}${notesLine}`
}

export function buildRunLog(input: {
  job: ScheduleJob
  triggerSource: ScheduleRunTriggerSource
  sessionId?: string | null
  sessionTitle?: string | null
  responseText?: string | null
  errorText?: string | null
  finishedAt: number
}): string {
  const scheduleLabel = input.job.scheduleMode === 'cron'
    ? `${input.job.cronExpression ?? ''} (${input.job.timezone ?? 'UTC'})`
    : `every ${input.job.intervalMinutes ?? 0} minutes`

  const lines = [
    `Job: ${input.job.name}`,
    `Trigger: ${input.triggerSource}`,
    `Finished: ${new Date(input.finishedAt).toISOString()}`,
    `Agent: ${input.job.agentSlug ?? 'default'}`,
    `Schedule: ${scheduleLabel}`,
  ]

  if (input.sessionId) {
    lines.push(`Session ID: ${input.sessionId}`)
  }

  if (input.sessionTitle) {
    lines.push(`Session title: ${input.sessionTitle}`)
  }

  if (input.errorText) {
    lines.push('', 'Error:', input.errorText)
  }

  if (input.responseText) {
    lines.push('', 'Assistant output:', input.responseText)
  }

  return lines.join('\n')
}

export function buildRunStartedLog(input: {
  job: ScheduleJob
  triggerSource: ScheduleRunTriggerSource
  sessionId: string
  sessionTitle: string
}): string {
  const scheduleLabel = input.job.scheduleMode === 'cron'
    ? `${input.job.cronExpression ?? ''} (${input.job.timezone ?? 'UTC'})`
    : `every ${input.job.intervalMinutes ?? 0} minutes`

  return [
    `Job: ${input.job.name}`,
    `Trigger: ${input.triggerSource}`,
    `Started: ${new Date().toISOString()}`,
    `Agent: ${input.job.agentSlug ?? 'default'}`,
    `Schedule: ${scheduleLabel}`,
    `Session ID: ${input.sessionId}`,
    `Session title: ${input.sessionTitle}`,
    '',
    'Run started. Waiting for assistant response...',
  ].join('\n')
}

export function extractAssistantMessageText(parts: SessionMessagePart[] | undefined): string {
  return (parts ?? [])
    .filter((part) => part.type === 'text' && typeof part.text === 'string')
    .map((part) => part.text?.replace(/<think>[\s\S]*?<\/think>\s*/g, '').trim() ?? '')
    .filter(Boolean)
    .join('\n\n')
}

export function getAssistantMessageState(messages: SessionMessage[]): {
  responseText: string | null
  errorText: string | null
  completed: boolean
} | null {
  const assistantMessage = [...messages]
    .reverse()
    .find((message) => message.info?.role === 'assistant')

  if (!assistantMessage) {
    return null
  }

  return {
    responseText: extractAssistantMessageText(assistantMessage.parts) || null,
    errorText: assistantMessage.info?.error?.data?.message ?? assistantMessage.info?.error?.name ?? null,
    completed: Boolean(assistantMessage.info?.time?.completed),
  }
}

export function getSessionEventId(event: SSEEvent): string | null {
  const properties = event.properties as {
    sessionID?: string
    info?: { id?: string }
  }

  return properties.sessionID ?? properties.info?.id ?? null
}

export function getSessionErrorText(event: SSEEvent): string | null {
  const properties = event.properties as {
    error?: {
      name?: string
      data?: {
        message?: string
      }
    }
  }

  return properties.error?.data?.message ?? properties.error?.name ?? null
}

export function getSessionStatusType(event: SSEEvent): string | null {
  const properties = event.properties as {
    status?: {
      type?: string
    }
  }

  return properties.status?.type ?? null
}

export function createSessionMonitor(directory: string, sessionId: string): SessionMonitor {
  const queued: SessionSignal[] = []
  let waiting: ((signal: SessionSignal) => void) | null = null
  let disposed = false

  const push = (signal: SessionSignal): void => {
    if (waiting) {
      const resolve = waiting
      waiting = null
      resolve(signal)
      return
    }
    queued.push(signal)
  }

  const unsubscribe = sseAggregator.onEvent((eventDirectory, event) => {
    if (eventDirectory !== directory) {
      return
    }

    if (getSessionEventId(event) !== sessionId) {
      return
    }

    if (event.type === 'session.error') {
      push({ errorText: getSessionErrorText(event) ?? 'The session reported an unknown error.', disposed: false })
      return
    }

    if (event.type === 'session.idle' || (event.type === 'session.status' && getSessionStatusType(event) === 'idle')) {
      push({ errorText: null, disposed: false })
    }
  })

  return {
    markSubmitted: () => {
      queued.length = 0
    },
    nextSignal: () => {
      const next = queued.shift()
      if (next) {
        return Promise.resolve(next)
      }
      if (disposed) {
        return Promise.resolve({ errorText: null, disposed: true })
      }
      return new Promise<SessionSignal>((resolve) => { waiting = resolve })
    },
    dispose: () => {
      if (disposed) {
        return
      }
      disposed = true
      unsubscribe()
      push({ errorText: null, disposed: true })
    },
  }
}
