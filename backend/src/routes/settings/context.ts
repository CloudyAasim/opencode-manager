import type { Database } from 'bun:sqlite'
import type { Context } from 'hono'
import { SettingsService } from '../../services/settings'
import type { OpenCodeClient } from '../../services/opencode/client'
import type { OpenCodeSupervisor } from '../../services/opencode-supervisor'
import type { GitAuthService } from '../../services/git-auth'

export interface SettingsRouteContext {
  db: Database
  gitAuthService: GitAuthService
  openCodeClient: OpenCodeClient
  openCodeSupervisor?: OpenCodeSupervisor
  settingsService: SettingsService
  currentUserId: (c: Context) => string
}

export function createSettingsRouteContext(
  db: Database,
  gitAuthService: GitAuthService,
  openCodeClient: OpenCodeClient,
  openCodeSupervisor?: OpenCodeSupervisor,
): SettingsRouteContext {
  return {
    db,
    gitAuthService,
    openCodeClient,
    openCodeSupervisor,
    settingsService: new SettingsService(db),
    currentUserId: (c: Context) => {
      const ctx = c as unknown as { get?: (key: string) => { id?: string } | undefined }
      return ctx.get?.('user')?.id ?? 'default'
    },
  }
}
