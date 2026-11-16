import {
  OpenCodeOAuthErrorSchema,
  type OpenCodeOAuthError,
} from '@opencode-manager/shared/schemas/agent-oauth'
import type {
  ProviderAuthFailure,
  ProviderAuthMethods,
  ProviderAuthMethod,
  ProviderOAuthAuthorization,
  PromptField,
} from '@opencode-manager/shared/api/v1'

/**
 * The agent's words about logging in, and this layer's words about the same.
 *
 * The agent says what it calls its own failures; a client is told what
 * happened in words it already knows. That is the whole job of this file.
 */

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function asString(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

/**
 * The agent's own name for each of its failures, and what this layer calls
 * the same thing.
 *
 * The agent's names are not carried any further than this table: a client that
 * was told "ProviderAuthOauthCodeMissing" would be holding the agent's
 * vocabulary, and the whole point of the layer is that the client does not.
 */
const FAILURE_BY_AGENT_NAME: Record<string, ProviderAuthFailure> = {
  BadRequest: 'bad_request',
  ProviderAuthOauthMissing: 'authorization_missing',
  ProviderAuthOauthCodeMissing: 'code_missing',
  ProviderAuthOauthCallbackFailed: 'callback_failed',
  ProviderAuthValidationFailed: 'validation_failed',
  InvalidRequestError: 'invalid_request',
}

/**
 * A failure, said in this layer's words.
 */
export interface ProviderAuthFailureAnswer {
  reason: ProviderAuthFailure
  /** What the agent said, for the person to read. */
  detail: string | null
}

/**
 * Reading the agent's failure.
 *
 * A body that is not a failure at all is still a failure - there is no answer
 * to a request that was not answered - so it is reported as a bad request
 * rather than as nothing.
 */
export function toProviderAuthFailure(body: string): ProviderAuthFailureAnswer {
  let parsed: unknown
  try {
    parsed = JSON.parse(body)
  } catch {
    return { reason: 'bad_request', detail: null }
  }

  const result = OpenCodeOAuthErrorSchema.safeParse(parsed)
  if (!result.success) {
    return { reason: 'bad_request', detail: null }
  }

  return toProviderAuthFailureOf(result.data)
}

function toProviderAuthFailureOf(error: OpenCodeOAuthError): ProviderAuthFailureAnswer {
  const tagged = '_tag' in error
  const name = tagged ? error._tag : error.name
  const message = tagged ? error.message : error.data.message
  const field = tagged ? error.field : error.data.field

  const detail = [
    message?.replace(/\s+/g, ' ').trim() || undefined,
    field ? `field: ${field}` : undefined,
  ]
    .filter(Boolean)
    .join(' — ')

  return {
    reason: FAILURE_BY_AGENT_NAME[name] ?? 'bad_request',
    detail: detail || null,
  }
}

/**
 * The questions a provider asks before it will let anybody in.
 *
 * The agent's questions come in two shapes - a text and a choice - and this
 * layer's are one shape with "none" in the fields that do not apply. That way
 * a client asks whether there are choices rather than which of the fields
 * happens to be there.
 *
 * A question that cannot be read is dropped: a client that is shown a
 * question it cannot draw is worse off than one that is not shown it at all.
 */
function toPromptField(raw: unknown): PromptField | null {
  const record = asRecord(raw)
  if (!record) return null

  const type = asString(record.type)
  if (type !== 'text' && type !== 'select') return null

  const key = asString(record.key)
  const message = asString(record.message)
  if (!key || !message) return null

  const options = Array.isArray(record.options)
    ? record.options
        .map((entry) => {
          const option = asRecord(entry)
          const label = option ? asString(option.label) : null
          const value = option ? asString(option.value) : null
          if (!label || !value) return null
          return {
            label,
            value,
            // The agent says what else is worth knowing about a choice. It is
            // said here too: dropping it would be the layer quietly losing
            // something the person would have read.
            hint: option ? asString(option.hint) : null,
          }
        })
        .filter((entry): entry is { label: string; value: string; hint: string | null } => entry !== null)
    : null

  const when = asRecord(record.when)
  const whenKey = when ? asString(when.key) : null
  const whenValue = when ? asString(when.value) : null
  const whenOperator = when ? asString(when.op) : null

  // The condition on a question is one answer, not a condition: the answer
  // equals the value. The agent spells that with an operator, and this layer
  // carries what it means rather than how it is spelled - but only when the
  // operator is the one that means equality. A question whose condition this
  // layer does not understand is dropped: making it unconditional would ask
  // a question that should not have been asked.
  if (when && whenOperator !== null && whenOperator !== 'eq') return null

  return {
    type,
    key,
    message,
    placeholder: asString(record.placeholder),
    options,
    when: whenKey && whenValue ? { key: whenKey, value: whenValue } : null,
  }
}

/**
 * How each provider may be logged in.
 *
 * A provider whose ways of logging in cannot be read is not in the answer at
 * all: it is not that it has no ways, it is that this layer does not know what
 * they are.
 */
export function toProviderAuthMethods(raw: unknown): ProviderAuthMethods {
  const record = asRecord(raw)
  if (!record) return {}

  const methods: ProviderAuthMethods = {}
  for (const [providerId, value] of Object.entries(record)) {
    if (!Array.isArray(value)) continue

    const read: ProviderAuthMethod[] = []
    for (const entry of value) {
      const method = asRecord(entry)
      if (!method) continue

      const type = asString(method.type)
      if (type !== 'oauth' && type !== 'api') continue

      const label = asString(method.label)
      if (!label) continue

      const prompts = Array.isArray(method.prompts)
        ? method.prompts
            .map((prompt) => toPromptField(prompt))
            .filter((prompt): prompt is NonNullable<ReturnType<typeof toPromptField>> => prompt !== null)
        : null

      read.push({ type, label, prompts })
    }

    if (read.length > 0) methods[providerId] = read
  }

  return methods
}

/**
 * An authorization that has been started.
 *
 * There is no way to draw an authorization that does not say where to go, so
 * an answer that does not is not one: it is refused rather than handed on.
 */
export function toProviderOAuthAuthorization(raw: unknown): ProviderOAuthAuthorization | null {
  const record = asRecord(raw)
  if (!record) return null

  const url = asString(record.url)
  const instructions = asString(record.instructions)
  const method = asString(record.method)
  if (!url || !instructions || (method !== 'auto' && method !== 'code')) return null

  return { url, method, instructions }
}
