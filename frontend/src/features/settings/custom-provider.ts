import { z } from 'zod'
import { i18n } from '@/lib/i18n'

/**
 * Declaring a custom provider, as a value the dialog edits and the config
 * writer merges.
 *
 * Manager keeps no provider catalogue of its own: the list Settings shows is
 * whatever OpenCode reports, so "adding a provider" means adding a
 * `provider.<id>` block to the config and letting OpenCode pick it up on the
 * next load. That is why this is a config edit and not a registration.
 *
 * **There is no `apiKey` field, on purpose.** Credentials are per user
 * (`UserProviderService` writes `provider.<id>.options.apiKey` into that user's
 * own `opencode.json`), and the three global config sources are deep-merged with
 * `opencodode.jsonc` winning per leaf. A key written here would therefore beat
 * the one the user enters in Settings > Providers, silently, with nothing on
 * screen saying so. The key is asked for in the next step instead.
 */

export const CUSTOM_PROVIDER_ID_PATTERN = /^[a-z0-9-]+$/
export const CUSTOM_MODEL_ID_PATTERN = /^[a-zA-Z0-9._/-]+$/

export interface CustomProviderDraft {
  providerId: string
  name?: string
  kind: 'api' | 'npm'
  baseUrl?: string
  npm?: string
  models: Array<{ id: string; name?: string }>
}

export interface CustomProviderEntry {
  name: string
  api?: string
  npm?: string
  options?: Record<string, unknown>
  models: Record<string, { name: string }>
}

/**
 * Field shapes carry no messages. Every message is raised from `superRefine`,
 * which runs at validation time, so switching language re-reads it - a message
 * baked in with `.min(1, i18n.t(...))` is frozen at module load, which is the
 * wart `OpenCodeModelDialog` still carries.
 */
const modelRowSchema = z.object({
  id: z.string().trim(),
  name: z.string().trim().optional(),
})

export const customProviderFormSchema = z
  .object({
    providerId: z.string().trim(),
    name: z.string().trim().optional(),
    kind: z.enum(['api', 'npm']),
    baseUrl: z.string().trim().optional(),
    npm: z.string().trim().optional(),
    models: z.array(modelRowSchema),
  })
  .superRefine((values, ctx) => {
    const providerId = values.providerId

    if (!providerId) {
      ctx.addIssue({ code: 'custom', path: ['providerId'], message: i18n.t('settingsPanels.customProvider.errors.providerIdRequired') })
    } else if (!CUSTOM_PROVIDER_ID_PATTERN.test(providerId)) {
      ctx.addIssue({ code: 'custom', path: ['providerId'], message: i18n.t('settingsPanels.customProvider.errors.providerIdFormat') })
    }

    if (values.kind === 'api' && !values.baseUrl) {
      ctx.addIssue({ code: 'custom', path: ['baseUrl'], message: i18n.t('settingsPanels.customProvider.errors.baseUrlRequired') })
    }
    if (values.kind === 'npm' && !values.npm) {
      ctx.addIssue({ code: 'custom', path: ['npm'], message: i18n.t('settingsPanels.customProvider.errors.npmRequired') })
    }

    if (values.models.length === 0) {
      ctx.addIssue({ code: 'custom', path: ['models'], message: i18n.t('settingsPanels.customProvider.errors.modelsRequired') })
    }

    // Duplicates would silently collapse in the record this becomes, so the
    // second one has to be refused rather than overwrite the first.
    const seen = new Set<string>()
    values.models.forEach((row, index) => {
      if (!row.id) {
        ctx.addIssue({ code: 'custom', path: ['models', index, 'id'], message: i18n.t('settingsPanels.customProvider.errors.modelIdRequired') })
        return
      }
      if (!CUSTOM_MODEL_ID_PATTERN.test(row.id)) {
        ctx.addIssue({ code: 'custom', path: ['models', index, 'id'], message: i18n.t('settingsPanels.customProvider.errors.modelIdFormat') })
        return
      }
      if (seen.has(row.id)) {
        ctx.addIssue({ code: 'custom', path: ['models', index, 'id'], message: i18n.t('settingsPanels.customProvider.errors.modelIdDuplicate', { id: row.id }) })
        return
      }
      seen.add(row.id)
    })
  })

export type CustomProviderFormValues = z.infer<typeof customProviderFormSchema>

export function emptyCustomProviderDraft(): CustomProviderDraft {
  return { providerId: '', name: '', kind: 'api', baseUrl: '', npm: '', models: [{ id: '', name: '' }] }
}

/**
 * The `provider.<id>` block.
 *
 * `api` and `options.baseURL` are both written, which is redundant on purpose:
 * OpenCode reads one of them depending on the sdk, and the existing model
 * editor already does the same thing, so a provider created here behaves
 * exactly like one created there.
 */
export function buildCustomProviderEntry(draft: CustomProviderDraft): CustomProviderEntry {
  const models: Record<string, { name: string }> = {}
  for (const row of draft.models) {
    const id = row.id.trim()
    if (!id) continue
    models[id] = { name: row.name?.trim() || id }
  }

  const entry: CustomProviderEntry = {
    name: draft.name?.trim() || draft.providerId.trim(),
    models,
  }

  if (draft.kind === 'api') {
    const baseUrl = draft.baseUrl?.trim() ?? ''
    entry.api = baseUrl
    entry.options = { baseURL: baseUrl }
  } else {
    entry.npm = draft.npm?.trim()
  }

  return entry
}

/**
 * Adds one key to an already-merged config.
 *
 * The merged view is what the update API compares against, and it only writes
 * the JSON paths that changed - so passing the merged content is how the other
 * two source files keep their layering instead of being flattened in here.
 */
export function withCustomProvider(
  config: Record<string, unknown>,
  draft: CustomProviderDraft,
): Record<string, unknown> {
  const providers = (config.provider as Record<string, unknown> | undefined) ?? {}
  return {
    ...config,
    provider: {
      ...providers,
      [draft.providerId.trim()]: buildCustomProviderEntry(draft),
    },
  }
}

/**
 * The id a draft wants, if that id is already declared.
 *
 * Writing anyway would replace the existing provider wholesale - its models
 * included - so this is asked before anything is sent rather than discovered
 * afterwards.
 */
export function conflictingProviderId(
  draft: Pick<CustomProviderDraft, 'providerId'>,
  existingProviderIds: readonly string[],
): string | null {
  const id = draft.providerId.trim()
  if (!id) return null
  return existingProviderIds.includes(id) ? id : null
}
