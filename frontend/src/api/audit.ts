import { API_BASE_URL } from '@/config'
import { fetchWrapper } from './fetchWrapper'

export interface TerminalAuditEntry {
  id: string
  userId: string
  userEmail: string | null
  ipAddress: string | null
  userAgent: string | null
  shell: string | null
  cwd: string | null
  cols: number | null
  rows: number | null
  startedAt: number
  endedAt: number | null
  exitCode: number | null
  closeReason: string | null
  totalBytes: number
  active: boolean
}

export interface TerminalAuditResponse {
  entries: TerminalAuditEntry[]
  total: number
}

export interface TerminalAuditQuery {
  email?: string
  active?: boolean
  from?: number
  to?: number
  limit?: number
  offset?: number
}

/**
 * One write to an OpenCode config file.
 *
 * `scope` says which file: `global` is the one every session on the server
 * reads, `user` is a single tenant's own copy. It is on the row rather than
 * implied by which panel is showing it because the two read very differently
 * once someone is looking at the list trying to work out what happened.
 */
export interface OpenCodeConfigAuditEntry {
  id: string
  userId: string | null
  userEmail: string | null
  ipAddress: string | null
  userAgent: string | null
  scope: 'global' | 'user'
  subject: string | null
  source: string | null
  revision: string | null
  changedKeys: string[]
  details: Record<string, unknown> | null
  restartPending: boolean
  createdAt: number
}

export interface OpenCodeConfigAuditResponse {
  entries: OpenCodeConfigAuditEntry[]
  total: number
}

export interface OpenCodeConfigAuditQuery {
  email?: string
  scope?: 'global' | 'user'
  from?: number
  to?: number
  limit?: number
  offset?: number
}

const BASE = `${API_BASE_URL}/api/admin/audit`

export const auditApi = {
  listTerminal: async (query: TerminalAuditQuery = {}): Promise<TerminalAuditResponse> => {
    return fetchWrapper<TerminalAuditResponse>(`${BASE}/terminal`, {
      params: {
        email: query.email,
        active: query.active,
        from: query.from,
        to: query.to,
        limit: query.limit,
        offset: query.offset,
      },
    })
  },

  listConfig: async (query: OpenCodeConfigAuditQuery = {}): Promise<OpenCodeConfigAuditResponse> => {
    return fetchWrapper<OpenCodeConfigAuditResponse>(`${BASE}/opencode-config`, {
      params: {
        email: query.email,
        scope: query.scope,
        from: query.from,
        to: query.to,
        limit: query.limit,
        offset: query.offset,
      },
    })
  },

  /**
   * Prunes every audited table, not just one.
   *
   * `deleted` is the sum so the caller can show one number, and the per-table
   * counts are there so a half-pruned log is visible rather than reported as a
   * clean sweep.
   */
  prune: async (before: number): Promise<{ terminal: number; config: number; deleted: number }> => {
    return fetchWrapper<{ terminal: number; config: number; deleted: number }>(`${BASE}/prune`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ before }),
    })
  },
}
