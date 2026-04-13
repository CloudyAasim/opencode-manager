import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { Database } from 'bun:sqlite'

const mockDb = {
  prepare: vi.fn(),
  exec: vi.fn(),
  close: vi.fn(),
  transaction: vi.fn()
} as unknown as Database

vi.mock('bun:sqlite', () => ({
  Database: vi.fn(() => mockDb)
}))

vi.mock('../../src/db/queries', () => ({
  getRepoById: vi.fn(),
  updateLastAccessed: vi.fn()
}))

vi.mock('../../src/services/repo', () => ({
  getCurrentBranch: vi.fn()
}))

import * as db from '../../src/db/queries'
import { createRepoRoutes } from '../../src/routes/repos'
import type { GitAuthService } from '../../src/services/git-auth'
import type { ScheduleService } from '../../src/services/schedules'

const mockGitAuthService = {
  getGitEnvironment: vi.fn().mockReturnValue({})
} as unknown as GitAuthService

const mockScheduleService = {} as ScheduleService

describe('Repo Routes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('POST /:id/access', () => {
    it('should return 404 when repo not found', async () => {
      vi.mocked(db.getRepoById).mockReturnValue(null)

      const app = createRepoRoutes(mockDb, mockGitAuthService, mockScheduleService)
      const res = await app.request('/1/access', { method: 'POST' })

      expect(res.status).toBe(404)
      const body = await res.json() as { error: string }
      expect(body.error).toBe('Repo not found')
    })

    it('should return 200 and call updateLastAccessed when repo exists', async () => {
      const mockRepo = {
        id: 1,
        repoUrl: 'https://github.com/test/repo',
        localPath: 'repos/test-repo',
        fullPath: '/Users/test/repos/test-repo',
        sourcePath: '/Users/test/repos/test-repo',
        branch: 'main',
        defaultBranch: 'main',
        cloneStatus: 'ready' as const,
        clonedAt: Date.now(),
        lastAccessedAt: Date.now()
      }
      vi.mocked(db.getRepoById).mockReturnValue(mockRepo)

      const app = createRepoRoutes(mockDb, mockGitAuthService, mockScheduleService)
      const res = await app.request('/1/access', { method: 'POST' })

      expect(res.status).toBe(200)
      const body = await res.json() as { success: boolean }
      expect(body.success).toBe(true)
      expect(db.updateLastAccessed).toHaveBeenCalledWith(mockDb, 1)
    })

    it('should return 500 when updateLastAccessed throws', async () => {
      const mockRepo = {
        id: 1,
        repoUrl: 'https://github.com/test/repo',
        localPath: 'repos/test-repo',
        fullPath: '/Users/test/repos/test-repo',
        sourcePath: '/Users/test/repos/test-repo',
        branch: 'main',
        defaultBranch: 'main',
        cloneStatus: 'ready' as const,
        clonedAt: Date.now()
      }
      vi.mocked(db.getRepoById).mockReturnValue(mockRepo)
      vi.mocked(db.updateLastAccessed).mockImplementation(() => {
        throw new Error('Database error')
      })

      const app = createRepoRoutes(mockDb, mockGitAuthService, mockScheduleService)
      const res = await app.request('/1/access', { method: 'POST' })

      expect(res.status).toBe(500)
      const body = await res.json() as { error: string }
      expect(body.error).toBe('Database error')
    })
  })
})