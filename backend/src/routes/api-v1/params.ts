import type { Context } from 'hono'
import type { ProviderContext } from '../../providers/contract'

/**
 * The agent that answers. Omitted, the default agent answers.
 */
export function agentIdOf(c: Context): string | undefined {
  const value = c.req.query('agent')
  return value && value.trim() ? value : undefined
}

/**
 * Where the agent is working.
 *
 * The versioned API speaks to one agent in one working directory at a time,
 * so the directory is a query parameter rather than part of an id.
 */
export function contextOf(c: Context): ProviderContext {
  const directory = c.req.query('directory')
  return directory ? { directory } : {}
}
