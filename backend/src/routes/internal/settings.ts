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
 * A placed request now reads and writes only its own, whatever the query
 * string asks for. An unplaced one keeps the old behaviour rather than
 * guessing - the shadow log above says how often that is happening, and
 * refusing is the stage after this one.
 */
function resolveSettingsUserId(c: unknown): string {
  const user = internalUserOf(c)
  return user ? user.id : (c as { req?: { query: (key: string) => string | undefined } }).req?.query('userId') ?? 'default'
}

export function createInternalSettingsRoutes(settingsService: SettingsService) {
  const app = new Hono()

  app.get('/', (c) => {
    const userId = resolveSettingsUserId(c)
    const settings = settingsService.getSettings(userId)
    return c.json(settings)
  })

  app.patch('/', async (c) => {
    const userId = resolveSettingsUserId(c)

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
