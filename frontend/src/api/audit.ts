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

  pruneTerminal: async (before: number): Promise<{ deleted: number }> => {
    return fetchWrapper<{ deleted: number }>(`${BASE}/terminal/prune`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ before }),
    })
  },
}
