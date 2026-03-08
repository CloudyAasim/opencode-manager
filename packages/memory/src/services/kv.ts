import type { Database } from 'bun:sqlite'
import { createKvQuery } from '../storage/kv-queries'
import type { Logger } from '../types'

const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000

export interface KvEntry {
  key: string
  data: unknown
  updatedAt: number
  expiresAt: number
}

export interface KvService {
  get<T = unknown>(projectId: string, key: string): T | null
  set<T = unknown>(projectId: string, key: string, data: T, ttlMs?: number): void
  delete(projectId: string, key: string): void
  list(projectId: string): KvEntry[]
  startCleanup(intervalMs?: number): void
  destroy(): void
}

export function createKvService(db: Database, logger?: Logger): KvService {
  const queries = createKvQuery(db)
  let cleanupInterval: ReturnType<typeof setInterval> | null = null

  return {
    get<T = unknown>(projectId: string, key: string): T | null {
      const row = queries.get(projectId, key)
      if (!row) return null
      try {
        return JSON.parse(row.data) as T
      } catch {
        return null
      }
    },

    set<T = unknown>(projectId: string, key: string, data: T, ttlMs?: number): void {
      const expiresAt = Date.now() + (ttlMs ?? DEFAULT_TTL_MS)
      const jsonData = JSON.stringify(data)
      queries.set(projectId, key, jsonData, expiresAt)
    },

    delete(projectId: string, key: string): void {
      queries.delete(projectId, key)
    },

    list(projectId: string): KvEntry[] {
      const rows = queries.list(projectId)
      return rows.map((row) => {
        let data: unknown = null
        try {
          data = JSON.parse(row.data)
        } catch {
        }
        return {
          key: row.key,
          data,
          updatedAt: row.updatedAt,
          expiresAt: row.expiresAt,
        }
      })
    },

    startCleanup(intervalMs: number = 30 * 60 * 1000): void {
      if (cleanupInterval) return
      cleanupInterval = setInterval(() => {
        try {
          const deleted = queries.deleteExpired()
          if (deleted > 0) {
            logger?.log(`KV cleanup: removed ${deleted} expired entries`)
          }
        } catch (error) {
          logger?.error('KV cleanup failed', error)
        }
      }, intervalMs)
    },

    destroy(): void {
      if (cleanupInterval) {
        clearInterval(cleanupInterval)
        cleanupInterval = null
      }
    },
  }
}
