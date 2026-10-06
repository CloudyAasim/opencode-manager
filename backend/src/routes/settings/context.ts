import type { Database } from 'bun:sqlite'
import type { Context } from 'hono'
import { SettingsService } from '../../services/settings'
import type { OpenCodeClient } from '../../services/opencode/client'
import type { OpenCodeSupervisor } from '../../services/opencode-supervisor'
import type { GitAuthService } from '../../services/git-auth'
import { principalFrom, type Principal } from '../../auth/ownership'
import { settingsOwnerId } from '../../auth/settings-owner'
import type { Session } from '../../auth'

export interface SettingsRouteContext {
  db: Database
  gitAuthService: GitAuthService
  openCodeClient: OpenCodeClient
  openCodeSupervisor?: OpenCodeSupervisor
  settingsService: SettingsService
  currentUserId: (c: Context) => string
  /**
   * Who is asking, or null when the request carried no session.
   *
   * Separate from `currentUserId`, which falls back to `'default'` because
   * settings are per-user and an unattributable write still needs somewhere to
   * go. A visibility question has no such fallback: there is no `'default'`
   * tenant whose roots a stranger's directories could be measured against, so
   * routes that filter by ownership must refuse a null principal rather than
   * substitute one.
   */
  currentPrincipal: (c: Context) => Principal | null
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
    currentUserId: settingsOwnerId,
    currentPrincipal: (c: Context) =>
      principalFrom((c as unknown as { get?: (key: string) => Session['user'] | undefined }).get?.('user')),
  }
}
