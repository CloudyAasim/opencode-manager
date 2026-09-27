import { API_BASE_URL } from '@/config'
import { fetchWrapper, fetchWrapperVoid } from './fetchWrapper'

export interface TerminalSessionInfo {
  id: string
  userId: string
  userEmail: string
  shell: string
  cwd: string
  cols: number
  rows: number
  createdAt: number
  lastActivityAt: number
  exited: boolean
  exitCode: number | null
  closeReason: string
  totalBytes: number
}

export interface TerminalRuntimeConfig {
  enabled: boolean
  available: boolean
  shell: string
  cwd: string
  cols: number
  rows: number
  idleTimeoutMs: number
  maxDurationMs: number
  maxSessionsPerUser: number
  adminsOnly: boolean
  perUserHome: boolean
}

const BASE = `${API_BASE_URL}/api/terminal`

export const terminalApi = {
  getConfig: async (): Promise<TerminalRuntimeConfig> => {
    return fetchWrapper<TerminalRuntimeConfig>(`${BASE}/config`)
  },

  listSessions: async (): Promise<TerminalSessionInfo[]> => {
    const data = await fetchWrapper<{ sessions: TerminalSessionInfo[] }>(`${BASE}/sessions`)
    return data.sessions
  },

  createSession: async (dimensions: { cols: number; rows: number; cwd?: string }): Promise<TerminalSessionInfo> => {
    const data = await fetchWrapper<{ session: TerminalSessionInfo }>(`${BASE}/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(dimensions),
    })
    return data.session
  },

  sendInput: async (id: string, data: string): Promise<void> => {
    await fetchWrapperVoid(`${BASE}/sessions/${id}/input`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data }),
    })
  },

  resize: async (id: string, cols: number, rows: number): Promise<void> => {
    await fetchWrapperVoid(`${BASE}/sessions/${id}/resize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cols, rows }),
    })
  },

  close: async (id: string): Promise<void> => {
    await fetchWrapperVoid(`${BASE}/sessions/${id}`, { method: 'DELETE' })
  },

  streamUrl: (id: string, fromSeq = 0): string => {
    return `${BASE}/sessions/${id}/stream?from=${fromSeq}`
  },
}
