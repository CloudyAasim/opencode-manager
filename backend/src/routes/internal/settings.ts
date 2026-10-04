import { Hono } from 'hono'
import { AssistantSettingsPatchSchema } from '@opencode-manager/shared/schemas'
import { internalUserOf } from '../../auth/internal-token-middleware'
import type { SettingsService } from '../../services/settings'
import type { UserPreferences } from '@opencode-manager/shared/types'

/**
 * Settings are keyed by user, and a stored set can hold TTS and STT API keys.
 * So `?userId=` was not a filter, it was a selector: any agent holding the
 * shared token could read another tenant's credentials by naming them.
 *
 * A placed request reads and writes only its own, whatever the query string
 * asks for.
 *
 * An unplaced one used to fall back to `?userId=`, which meant the selector
 * this stage set out to remove was still there for anyone who could get an
 * unlabelled request through. It cannot any more - and a fallback that reads
 * somebody else's settings is not something to keep around in case the
 * middleware changes its mind. There is no fallback.
 */
function resolveSettingsUserId(c: unknown): string | null {
  return internalUserOf(c)?.id ?? null
}

export function createInternalSettingsRoutes(settingsService: SettingsService) {
  const app = new Hono()

  app.get('/', (c) => {
    const userId = resolveSettingsUserId(c)
    if (!userId) return c.json({ error: 'Unauthorized' }, 401)
    const settings = settingsService.getSettings(userId)
    return c.json(settings)
  })

  app.patch('/', async (c) => {
    const userId = resolveSettingsUserId(c)
    if (!userId) return c.json({ error: 'Unauthorized' }, 401)

    let body: unknown
    try {
      body = await c.req.json()
    } catch {
      return c.json({ error: 'Invalid JSON' }, 400)
    }

    const parsed = AssistantSettingsPatchSchema.safeParse(body)
    if (!parsed.success) {
      return c.json({ error: 'Invalid request body', details: parsed.error.issues }, 400)
    }

    const patch = parsed.data
    const currentPrefs = settingsService.getSettings(userId).preferences
    const updates: Partial<UserPreferences> = {}
    for (const key of Object.keys(patch)) {
      if (key !== 'tts' && key !== 'stt') {
        (updates as Record<string, unknown>)[key] = (patch as Record<string, unknown>)[key]
      }
    }
    if (patch.tts) {
      if (!currentPrefs.tts?.apiKey) {
        return c.json({ error: 'TTS is not configured. Set up TTS (including credentials) in the UI before adjusting it.' }, 400)
      }
      updates.tts = { ...currentPrefs.tts, ...patch.tts }
    }
    if (patch.stt) {
      if (!currentPrefs.stt?.apiKey) {
        return c.json({ error: 'STT is not configured. Set up STT (including credentials) in the UI before adjusting it.' }, 400)
      }
      updates.stt = { ...currentPrefs.stt, ...patch.stt }
    }

    const updated = settingsService.updateSettings(updates as Partial<UserPreferences>, userId)
    return c.json(updated)
  })

  return app
}
