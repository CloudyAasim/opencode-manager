import type { PendingPermission, PendingQuestion, Session } from '@opencode-manager/shared/api/v1'
import { fetchWrapper } from './fetchWrapper'

/**
 * Where the session list lives.
 *
 * Written out in full, because this is the address the client talks to for
 * its list: the layer the client talks to, not the agent behind it.
 */
export const BFF_SESSIONS_ENDPOINT = '/api/bff/sessions'

/**
 * Where the pending requests live.
 *
 * The same layer, the same rule: the client asks it, and it asks the agent.
 */
export const BFF_PENDING_ENDPOINT = '/api/bff/pending'

/**
 * The layer the client talks to for its session list.
 *
 * The client used to ask the agent directly and merge the answers itself:
 * one request per working directory, one cursor per directory, and the
 * merging done in the browser. That is a server's job, so it moved here.
 */
export interface BffSessionListResponse {
  sessions: Session[]
  /** Where the next page of each directory starts. */
  cursors: Record<string, string>
}

export interface BffSessionListOptions {
  /** How many sessions to ask for, per directory. */
  limit?: number
  search?: string
  /** The cursors from a previous answer. */
  cursors?: Record<string, string>
}

/**
 * What the agent is waiting for, across the named directories.
 */
export interface BffPendingResponse {
  permissions: PendingPermission[]
  questions: PendingQuestion[]
}

export class BffClient {
  /** The address of the server this layer is on. */
  private baseURL: string

  constructor(baseURL: string) {
    this.baseURL = baseURL
  }

  async listSessions(
    directories: string[],
    options: BffSessionListOptions = {},
  ): Promise<BffSessionListResponse> {
    const params = new URLSearchParams()
    for (const directory of directories) {
      params.append('directories', directory)
    }
    if (options.limit !== undefined) params.set('limit', String(options.limit))
    if (options.search) params.set('search', options.search)
    if (options.cursors && Object.keys(options.cursors).length > 0) {
      params.set('cursors', JSON.stringify(options.cursors))
    }
    return fetchWrapper<BffSessionListResponse>(
      `${this.baseURL}${BFF_SESSIONS_ENDPOINT}?${params.toString()}`,
    )
  }

  /**
   * What the agent is waiting for, across the named directories.
   *
   * One request for every directory, the way the session list is one
   * request for every directory.
   */
  async listPending(directories: string[]): Promise<BffPendingResponse> {
    const params = new URLSearchParams()
    for (const directory of directories) {
      params.append('directories', directory)
    }
    return fetchWrapper<BffPendingResponse>(
      `${this.baseURL}${BFF_PENDING_ENDPOINT}?${params.toString()}`,
    )
  }
}

export const createBffClient = (baseURL: string) => new BffClient(baseURL)
