import { ConversationEventSchema } from '@opencode-manager/shared/api/v1'
import { toConversationStatus, toMessage, toMessageError, toPart, toSession } from './adapter'

/**
 * What the agent says about a conversation, said in the versioned dialect.
 *
 * The event stream is the one place where the agent's own words travel: it is
 * relayed, not asked for, and it arrives whether anybody is looking for it or
 * not. But a client that read a conversation over HTTP and then watched it
 * change would otherwise be holding two shapes for the same conversation - one
 * from the answer and one from the stream - and every reader of it would have
 * to know which one it was holding.
 *
 * So the conversation's events are said in the same words as the conversation
 * itself, and they are said by the same translator that says it over HTTP.
 * There is one translation of an agent's message, not two that can disagree.
 *
 * The events that are not about the conversation - what it is waiting for,
 * which version of the program is running - are left as the agent says them.
 * They carry no shape of a conversation, so they cannot put two shapes into
 * one place.
 */

const AGENT_ID = 'opencode'

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function asString(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

/**
 * One event, in the versioned dialect - or null when the agent said something
 * this layer does not know how to say.
 *
 * A null is not an error and not a lost event: it means the event was one of
 * the conversation's and could not be read. An event that is not one of the
 * conversation's is handed on untouched.
 *
 * The two are told apart on purpose. Handing on half a conversation in the
 * agent's words would put two dialects in one stream, which is the thing this
 * exists to prevent - so an event of the conversation's that cannot be read
 * is dropped rather than passed on.
 */
export function toVersionedEvent(raw: unknown): unknown {
  const event = asRecord(raw)
  const type = asString(event?.type)
  const properties = asRecord(event?.properties)
  if (!type || !properties) return raw

  try {
    const translation = translate(type, properties)
    if (translation.kind === 'not-ours') return raw

    // The shape is the judge. An event of the conversation's that cannot be
    // said in the versioned dialect has no event to say, and the shape says
    // so - and it is dropped rather than handed on in the agent's words,
    // because half a conversation in two dialects is worse than no event.
    const parsed = ConversationEventSchema.safeParse(translation.event)
    if (!parsed.success) return null
    return parsed.data
  } catch {
    return null
  }
}

/**
 * What the translator made of an event.
 *
 * `not-ours` is an event about something else - what the agent is waiting for,
 * which version of the program is running - and it is left alone. Everything
 * else is an event of the conversation's, and has to be said in the versioned
 * dialect or dropped.
 */
type Translation =
  | { kind: 'not-ours' }
  | { kind: 'ours'; event: unknown }

const NOT_OURS: Translation = { kind: 'not-ours' }

/** An event of the conversation's with nothing to say. */
const NOTHING_TO_SAY: Translation = { kind: 'ours', event: undefined }

function event(value: unknown): Translation {
  return { kind: 'ours', event: value }
}

function translate(type: string, properties: Record<string, unknown>): Translation {
  if (type === 'session.created') {
    const session = toSession(properties.info, AGENT_ID)
    return event({ type, properties: { sessionId: session.id, session } })
  }

  if (type === 'session.updated') {
    const session = toSession(properties.info, AGENT_ID)
    return event({ type, properties: { session } })
  }

  if (type === 'session.deleted') {
    const sessionId = asString(properties.sessionID)
    if (!sessionId) return NOTHING_TO_SAY
    return event({ type, properties: { sessionId } })
  }

  if (type === 'session.idle' || type === 'session.compacted') {
    const sessionId = asString(properties.sessionID)
    if (!sessionId) return NOTHING_TO_SAY
    return event({ type, properties: { sessionId } })
  }

  if (type === 'session.status') {
    const sessionId = asString(properties.sessionID)
    if (!sessionId) return NOTHING_TO_SAY
    const status = toConversationStatus(properties.status)
    if (!status) return NOTHING_TO_SAY
    return event({ type, properties: { sessionId, status } })
  }

  if (type === 'session.error') {
    return event({
      type,
      properties: {
        sessionId: asString(properties.sessionID),
        error: properties.error ? toMessageError(properties.error) : null,
      },
    })
  }

  if (type === 'message.updated') {
    return event({ type, properties: { message: toMessage({ info: properties.info }, AGENT_ID) } })
  }

  if (type === 'message.part.updated') {
    const raw = asRecord(properties.part)
    const sessionId = asString(raw?.sessionID)
    const messageId = asString(raw?.messageID)
    if (!sessionId || !messageId) return NOTHING_TO_SAY
    return event({
      type,
      properties: {
        sessionId,
        messageId,
        part: toPart(raw),
      },
    })
  }

  if (type === 'message.part.delta') {
    const sessionId = asString(properties.sessionID)
    const messageId = asString(properties.messageID)
    const partId = asString(properties.partID)
    const delta = asString(properties.delta)
    if (!sessionId || !messageId || !partId || delta === null) return NOTHING_TO_SAY
    return event({
      type,
      properties: {
        sessionId,
        messageId,
        partId,
        field: asString(properties.field) ?? 'text',
        delta,
      },
    })
  }

  if (type === 'message.part.removed') {
    const sessionId = asString(properties.sessionID)
    const messageId = asString(properties.messageID)
    const partId = asString(properties.partID)
    if (!sessionId || !messageId || !partId) return NOTHING_TO_SAY
    return event({ type, properties: { sessionId, messageId, partId } })
  }

  if (type === 'message.removed') {
    const sessionId = asString(properties.sessionID)
    const messageId = asString(properties.messageID)
    if (!sessionId || !messageId) return NOTHING_TO_SAY
    return event({ type, properties: { sessionId, messageId } })
  }

  return NOT_OURS
}
