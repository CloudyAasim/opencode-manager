import { z } from 'zod'
import { i18n } from '@/lib/i18n'

/**
 * A provider declared in the OpenCode config, as a value the dialogs edit and
 * the config writer merges.
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
 *
 * **A model is not a name.** `getProvidersFromOpenCodeServer` reads
 * `capabilities.*`, `cost.*` and `limit.*` off every model with almost no null
 * guards, and `useContextUsage` reads `limit.context` to decide how full the
 * conversation is. A model declared with only a name is therefore not a
 * half-finished entry, it is a broken one - so the limits are required here and
 * every capability is written explicitly rather than left to a default nobody
 * chose.
 */

export const CUSTOM_PROVIDER_ID_PATTERN = /^[a-z0-9-]+$/
export const CUSTOM_MODEL_ID_PATTERN = /^[a-zA-Z0-9._/-]+$/
export const CUSTOM_VARIANT_NAME_PATTERN = /^[a-zA-Z0-9._-]+$/

export const MODEL_STATUSES = ['active', 'beta', 'alpha', 'deprecated'] as const
export type ModelStatus = (typeof MODEL_STATUSES)[number]

export const MODALITIES = ['text', 'audio', 'image', 'video', 'pdf'] as const
export type Modality = (typeof MODALITIES)[number]

/** What the OpenAI-compatible endpoints accept for reasoning effort. */
export const REASONING_EFFORTS = ['minimal', 'low', 'medium', 'high'] as const
export type ReasoningEffort = (typeof REASONING_EFFORTS)[number]

/** How a streaming endpoint interleaves reasoning with the answer. */
export const INTERLEAVED_MODES = ['none', 'reasoning_content', 'reasoning_details'] as const
export type InterleavedMode = (typeof INTERLEAVED_MODES)[number]

export interface KeyValueDraft {
  name: string
  value: string
}

/**
 * One thinking level. OpenCode stores these as `variants`: a named map of
 * request options the model picker offers, so "high effort" is a variant
 * carrying `reasoningEffort: "high"` rather than a separate model.
 */
export interface CustomVariantDraft {
  name: string
  reasoningEffort: '' | ReasoningEffort
  /** Escape hatch for switches that are not a reasoning effort. */
  extraJson: string
}

export interface CustomModelDraft {
  id: string
  name: string
  family: string
  status: '' | ModelStatus
  releaseDate: string
  /** Kept as text: an empty numeric input must stay empty, not become 0. */
  contextLimit: string
  inputLimit: string
  outputLimit: string
  temperature: boolean
  reasoning: boolean
  attachment: boolean
  toolcall: boolean
  inputModalities: Record<Modality, boolean>
  outputModalities: Record<Modality, boolean>
  interleaved: InterleavedMode
  costInput: string
  costOutput: string
  costCacheRead: string
  costCacheWrite: string
  variants: CustomVariantDraft[]
  headers: KeyValueDraft[]
  /** Escape hatch for provider-specific request options. */
  optionsJson: string
}

export interface CustomProviderDraft {
  providerId: string
  name: string
  kind: 'api' | 'npm'
  baseUrl: string
  npm: string
  models: CustomModelDraft[]
}

/** The shape written into `provider.<id>.models.<modelId>`. */
export interface CustomModelEntry {
  name: string
  family?: string
  status?: ModelStatus
  release_date?: string
  limit: { context: number; output: number; input?: number }
  capabilities: {
    temperature: boolean
    reasoning: boolean
    attachment: boolean
    toolcall: boolean
    input: Record<Modality, boolean>
    output: Record<Modality, boolean>
    interleaved: boolean | { field: 'reasoning_content' | 'reasoning_details' }
  }
  cost?: { input: number; output: number; cache?: { read: number; write: number } }
  options?: Record<string, unknown>
  headers?: Record<string, string>
  variants?: Record<string, Record<string, unknown>>
}

export interface CustomProviderEntry {
  name: string
  api?: string
  npm?: string
  options?: Record<string, unknown>
  models: Record<string, CustomModelEntry>
}

// ---------------------------------------------------------------------------
// Draft defaults
// ---------------------------------------------------------------------------

/**
 * Text only, on purpose. Over-claiming a capability is the worse error: it makes
 * OpenCode send an image or a PDF to an endpoint that will reject it, whereas an
 * unclaimed one is a checkbox away.
 */
function defaultModalities(): Record<Modality, boolean> {
  return { text: true, audio: false, image: false, video: false, pdf: false }
}

export function emptyCustomVariantDraft(): CustomVariantDraft {
  return { name: '', reasoningEffort: '', extraJson: '' }
}

export function emptyCustomModelDraft(): CustomModelDraft {
  return {
    id: '',
    name: '',
    family: '',
    status: '',
    releaseDate: '',
    contextLimit: '',
    inputLimit: '',
    outputLimit: '',
    temperature: true,
    reasoning: false,
    attachment: false,
    toolcall: true,
    inputModalities: defaultModalities(),
    outputModalities: defaultModalities(),
    interleaved: 'none',
    costInput: '',
    costOutput: '',
    costCacheRead: '',
    costCacheWrite: '',
    variants: [],
    headers: [],
    optionsJson: '',
  }
}

export function emptyCustomProviderDraft(): CustomProviderDraft {
  return {
    providerId: '',
    name: '',
    kind: 'api',
    baseUrl: '',
    npm: '',
    models: [emptyCustomModelDraft()],
  }
}

// ---------------------------------------------------------------------------
// Coercion
// ---------------------------------------------------------------------------

/** `''` stays `undefined`. A zero is a real value and is kept. */
export function parseOptionalNumber(value: string | undefined): number | undefined {
  if (value === undefined || value.trim() === '') return undefined
  const n = Number(value)
  return Number.isFinite(n) ? n : undefined
}

export function parseJsonObject(
  value: string | undefined,
): { ok: true; value: Record<string, unknown> } | { ok: false } {
  if (!value || value.trim() === '') return { ok: true, value: {} }
  try {
    const parsed: unknown = JSON.parse(value)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { ok: false }
    return { ok: true, value: parsed as Record<string, unknown> }
  } catch {
    return { ok: false }
  }
}

function keyValueRecord(rows: readonly KeyValueDraft[]): Record<string, string> {
  const out: Record<string, string> = {}
  for (const row of rows) {
    const name = row.name.trim()
    if (name) out[name] = row.value
  }
  return out
}

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

/**
 * Field shapes carry no messages. Every message is raised from `superRefine`,
 * which runs at validation time, so switching language re-reads it - a message
 * baked in with `.min(1, i18n.t(...))` is frozen at module load, which is the
 * wart `OpenCodeModelDialog` still carries.
 */
const numericField = z.string().trim()

const keyValueSchema = z.object({
  name: z.string().trim(),
  value: z.string(),
})

const variantSchema = z.object({
  name: z.string().trim(),
  reasoningEffort: z.union([z.literal(''), z.enum(REASONING_EFFORTS)]),
  extraJson: z.string(),
})

const modelSchema = z.object({
  id: z.string().trim(),
  name: z.string().trim(),
  family: z.string().trim(),
  status: z.union([z.literal(''), z.enum(MODEL_STATUSES)]),
  releaseDate: z.string().trim(),
  contextLimit: numericField,
  inputLimit: numericField,
  outputLimit: numericField,
  temperature: z.boolean(),
  reasoning: z.boolean(),
  attachment: z.boolean(),
  toolcall: z.boolean(),
  inputModalities: z.object({
    text: z.boolean(),
    audio: z.boolean(),
    image: z.boolean(),
    video: z.boolean(),
    pdf: z.boolean(),
  }),
  outputModalities: z.object({
    text: z.boolean(),
    audio: z.boolean(),
    image: z.boolean(),
    video: z.boolean(),
    pdf: z.boolean(),
  }),
  interleaved: z.enum(INTERLEAVED_MODES),
  costInput: numericField,
  costOutput: numericField,
  costCacheRead: numericField,
  costCacheWrite: numericField,
  variants: z.array(variantSchema),
  headers: z.array(keyValueSchema),
  optionsJson: z.string(),
})

const providerSchema = z.object({
  providerId: z.string().trim(),
  name: z.string().trim(),
  kind: z.enum(['api', 'npm']),
  // Both stay required here. Only one is mounted at a time, and the dialog
  // writes '' into whichever one it hides - see the kind handler there.
  baseUrl: z.string().trim(),
  npm: z.string().trim(),
})

/** Positive integers only - a context window of -1 is not a smaller window. */
const POSITIVE_INTEGER = /^\d+$/

function checkNumericField(
  value: string,
  path: (string | number)[],
  ctx: z.RefinementCtx,
  messageKey: string,
): void {
  if (value === '') return
  if (!POSITIVE_INTEGER.test(value)) {
    ctx.addIssue({ code: 'custom', path, message: i18n.t(messageKey) })
  }
}

/** Read at validation time, never at module load, so a language switch is picked up. */
function msg(key: string, params?: Record<string, unknown>): string {
  return i18n.t(key, params)
}

/** One model, wherever it is being validated from. */
function checkModel(model: z.infer<typeof modelSchema>, at: (string | number)[], ctx: z.RefinementCtx): void {
  if (!model.id) {
    ctx.addIssue({ code: 'custom', path: [...at, 'id'], message: msg('settingsPanels.customProvider.errors.modelIdRequired') })
  } else if (!CUSTOM_MODEL_ID_PATTERN.test(model.id)) {
    ctx.addIssue({ code: 'custom', path: [...at, 'id'], message: msg('settingsPanels.customProvider.errors.modelIdFormat') })
  }

  // The two limits the rest of the app reads without a guard, so they are
  // required rather than merely suggested.
  if (model.contextLimit === '') {
    ctx.addIssue({ code: 'custom', path: [...at, 'contextLimit'], message: msg('settingsPanels.customProvider.errors.contextRequired') })
  } else {
    checkNumericField(model.contextLimit, [...at, 'contextLimit'], ctx, 'settingsPanels.customProvider.errors.limitNotANumber')
  }
  if (model.outputLimit === '') {
    ctx.addIssue({ code: 'custom', path: [...at, 'outputLimit'], message: msg('settingsPanels.customProvider.errors.outputRequired') })
  } else {
    checkNumericField(model.outputLimit, [...at, 'outputLimit'], ctx, 'settingsPanels.customProvider.errors.limitNotANumber')
  }
  checkNumericField(model.inputLimit, [...at, 'inputLimit'], ctx, 'settingsPanels.customProvider.errors.limitNotANumber')

  checkNumericField(model.costInput, [...at, 'costInput'], ctx, 'settingsPanels.customProvider.errors.costNotANumber')
  checkNumericField(model.costOutput, [...at, 'costOutput'], ctx, 'settingsPanels.customProvider.errors.costNotANumber')
  checkNumericField(model.costCacheRead, [...at, 'costCacheRead'], ctx, 'settingsPanels.customProvider.errors.costNotANumber')
  checkNumericField(model.costCacheWrite, [...at, 'costCacheWrite'], ctx, 'settingsPanels.customProvider.errors.costNotANumber')

  const seenVariants = new Set<string>()
  model.variants.forEach((variant, variantIndex) => {
    const variantAt = [...at, 'variants', variantIndex]
    if (!variant.name) {
      ctx.addIssue({ code: 'custom', path: [...variantAt, 'name'], message: msg('settingsPanels.customProvider.errors.variantNameRequired') })
    } else if (!CUSTOM_VARIANT_NAME_PATTERN.test(variant.name)) {
      ctx.addIssue({ code: 'custom', path: [...variantAt, 'name'], message: msg('settingsPanels.customProvider.errors.variantNameFormat') })
    } else if (seenVariants.has(variant.name)) {
      ctx.addIssue({ code: 'custom', path: [...variantAt, 'name'], message: msg('settingsPanels.customProvider.errors.variantNameDuplicate', { name: variant.name }) })
    } else {
      seenVariants.add(variant.name)
    }

    if (variant.extraJson.trim() && !parseJsonObject(variant.extraJson).ok) {
      ctx.addIssue({ code: 'custom', path: [...variantAt, 'extraJson'], message: msg('settingsPanels.customProvider.errors.variantOptionsInvalid') })
    }
  })

  const seenHeaders = new Set<string>()
  model.headers.forEach((header, headerIndex) => {
    const headerAt = [...at, 'headers', headerIndex]
    if (!header.name.trim()) {
      ctx.addIssue({ code: 'custom', path: [...headerAt, 'name'], message: msg('settingsPanels.customProvider.errors.headerNameRequired') })
    } else if (seenHeaders.has(header.name.trim())) {
      ctx.addIssue({ code: 'custom', path: [...headerAt, 'name'], message: msg('settingsPanels.customProvider.errors.headerNameDuplicate', { name: header.name.trim() }) })
    } else {
      seenHeaders.add(header.name.trim())
    }
  })

  if (model.optionsJson.trim() && !parseJsonObject(model.optionsJson).ok) {
    ctx.addIssue({ code: 'custom', path: [...at, 'optionsJson'], message: msg('settingsPanels.customProvider.errors.modelOptionsInvalid') })
  }
}

/** A model on its own, for the dialog that edits one. */
export const customModelFormSchema = modelSchema.superRefine((model, ctx) => {
  checkModel(model, [], ctx)
})

export type CustomModelFormValues = z.infer<typeof customModelFormSchema>

/** The provider's own fields. Models are validated by their own dialog. */
export const customProviderFormSchema = providerSchema.superRefine((values, ctx) => {
  const providerId = values.providerId

  if (!providerId) {
    ctx.addIssue({ code: 'custom', path: ['providerId'], message: msg('settingsPanels.customProvider.errors.providerIdRequired') })
  } else if (!CUSTOM_PROVIDER_ID_PATTERN.test(providerId)) {
    ctx.addIssue({ code: 'custom', path: ['providerId'], message: msg('settingsPanels.customProvider.errors.providerIdFormat') })
  }

  if (values.kind === 'api') {
    if (!values.baseUrl) {
      ctx.addIssue({ code: 'custom', path: ['baseUrl'], message: msg('settingsPanels.customProvider.errors.baseUrlRequired') })
    } else if (!/^https?:\/\//i.test(values.baseUrl)) {
      ctx.addIssue({ code: 'custom', path: ['baseUrl'], message: msg('settingsPanels.customProvider.errors.baseUrlFormat') })
    }
  }
  if (values.kind === 'npm' && !values.npm) {
    ctx.addIssue({ code: 'custom', path: ['npm'], message: msg('settingsPanels.customProvider.errors.npmRequired') })
  }
})

export type CustomProviderFormValues = z.infer<typeof customProviderFormSchema>

/** A whole provider, models included. Used by the merge path and its tests. */
export const customProviderWithModelsSchema = providerSchema
  .extend({ models: z.array(modelSchema) })
  .superRefine((values, ctx) => {
    // The provider's own rules, run through the very schema the form uses.
    // Hand-copying them here is how the URL check went missing once already:
    // two copies of one rule are two rules the day after the next edit.
    const providerOnly = customProviderFormSchema.safeParse(values)
    if (!providerOnly.success) {
      for (const issue of providerOnly.error.issues) {
        ctx.addIssue({ code: 'custom', path: issue.path, message: issue.message })
      }
    }

    if (values.models.length === 0) {
      ctx.addIssue({ code: 'custom', path: ['models'], message: msg('settingsPanels.customProvider.errors.modelsRequired') })
    }

    const seen = new Set<string>()
    values.models.forEach((model, index) => {
      checkModel(model, ['models', index], ctx)
      const id = model.id
      if (!id || seen.has(id)) {
        if (id && seen.has(id)) {
          ctx.addIssue({ code: 'custom', path: ['models', index, 'id'], message: msg('settingsPanels.customProvider.errors.modelIdDuplicate', { id }) })
        }
        return
      }
      seen.add(id)
    })
  })

export type CustomProviderWithModelsValues = z.infer<typeof customProviderWithModelsSchema>

// ---------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------

export function buildVariants(
  variants: readonly CustomVariantDraft[],
): Record<string, Record<string, unknown>> | undefined {
  const out: Record<string, Record<string, unknown>> = {}
  for (const variant of variants) {
    const name = variant.name.trim()
    if (!name) continue
    const extra = parseJsonObject(variant.extraJson)
    const body: Record<string, unknown> = extra.ok ? { ...extra.value } : {}
    if (variant.reasoningEffort) body.reasoningEffort = variant.reasoningEffort
    out[name] = body
  }
  return Object.keys(out).length > 0 ? out : undefined
}

export function buildCustomModelEntry(model: CustomModelDraft): CustomModelEntry {
  const id = model.id.trim()

  const entry: CustomModelEntry = {
    name: model.name.trim() || id,
    limit: {
      context: parseOptionalNumber(model.contextLimit) ?? 0,
      output: parseOptionalNumber(model.outputLimit) ?? 0,
    },
    capabilities: {
      temperature: model.temperature,
      reasoning: model.reasoning,
      attachment: model.attachment,
      toolcall: model.toolcall,
      input: { ...model.inputModalities },
      output: { ...model.outputModalities },
      interleaved:
        model.interleaved === 'none' ? false : { field: model.interleaved },
    },
  }

  const inputLimit = parseOptionalNumber(model.inputLimit)
  if (inputLimit !== undefined) entry.limit.input = inputLimit

  if (model.family.trim()) entry.family = model.family.trim()
  if (model.status) entry.status = model.status
  if (model.releaseDate.trim()) entry.release_date = model.releaseDate.trim()

  const costInput = parseOptionalNumber(model.costInput)
  const costOutput = parseOptionalNumber(model.costOutput)
  if (costInput !== undefined || costOutput !== undefined) {
    entry.cost = { input: costInput ?? 0, output: costOutput ?? 0 }
    const cacheRead = parseOptionalNumber(model.costCacheRead)
    const cacheWrite = parseOptionalNumber(model.costCacheWrite)
    if (cacheRead !== undefined || cacheWrite !== undefined) {
      entry.cost.cache = { read: cacheRead ?? 0, write: cacheWrite ?? 0 }
    }
  }

  const options = parseJsonObject(model.optionsJson)
  if (options.ok && Object.keys(options.value).length > 0) entry.options = options.value

  const headers = keyValueRecord(model.headers)
  if (Object.keys(headers).length > 0) entry.headers = headers

  const variants = buildVariants(model.variants)
  if (variants) entry.variants = variants

  return entry
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
  const models: Record<string, CustomModelEntry> = {}
  for (const model of draft.models) {
    const id = model.id.trim()
    if (!id) continue
    models[id] = buildCustomModelEntry(model)
  }

  const entry: CustomProviderEntry = {
    name: draft.name.trim() || draft.providerId.trim(),
    models,
  }

  if (draft.kind === 'api') {
    const baseUrl = draft.baseUrl.trim()
    entry.api = baseUrl
    entry.options = { baseURL: baseUrl }
  } else {
    entry.npm = draft.npm.trim()
  }

  return entry
}

// ---------------------------------------------------------------------------
// Merge into an already-merged config
// ---------------------------------------------------------------------------

/**
 * Adds or replaces one provider in an already-merged config.
 *
 * The merged view is what the update API compares against, and it only writes
 * the JSON paths that changed - so passing the merged content is how the other
 * two source files keep their layering instead of being flattened in here.
 *
 * Keys this file does not know about are carried over from whatever was already
 * there. `env`, `whitelist` and `blacklist` are written by hand in a config file
 * more often than not, and a save from here must not quietly drop them.
 */
export function withCustomProvider(
  config: Record<string, unknown>,
  draft: CustomProviderDraft,
): Record<string, unknown> {
  const providers = (config.provider as Record<string, unknown> | undefined) ?? {}
  const id = draft.providerId.trim()
  const existing = providers[id]
  const base = existing && typeof existing === 'object' && !Array.isArray(existing)
    ? (existing as Record<string, unknown>)
    : {}

  return {
    ...config,
    provider: {
      ...providers,
      [id]: { ...base, ...buildCustomProviderEntry(draft) },
    },
  }
}

/** Drops a declared provider and nothing else. */
export function withoutCustomProvider(
  config: Record<string, unknown>,
  providerId: string,
): Record<string, unknown> {
  const providers = (config.provider as Record<string, unknown> | undefined) ?? {}
  if (!(providerId in providers)) return config

  const next = { ...providers }
  delete next[providerId]
  return { ...config, provider: next }
}

/** Ids this config file declares, which is what the settings page can edit. */
export function declaredProviderIds(config: Record<string, unknown> | undefined): string[] {
  const providers = (config?.provider as Record<string, unknown> | undefined) ?? {}
  return Object.keys(providers)
}

/**
 * The id a draft wants, if that id is already declared.
 *
 * Writing anyway would replace the existing provider wholesale - its models
 * included - so a create has to refuse rather than discover it afterwards. An
 * edit is exempt, because that is the same provider coming back.
 */
export function conflictingProviderId(
  draft: Pick<CustomProviderDraft, 'providerId'>,
  existingProviderIds: readonly string[],
  mode: 'create' | 'edit' = 'create',
): string | null {
  if (mode === 'edit') return null
  const id = draft.providerId.trim()
  if (!id) return null
  return existingProviderIds.includes(id) ? id : null
}

// ---------------------------------------------------------------------------
// Read an existing declaration back into a draft
// ---------------------------------------------------------------------------

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function asBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function numberToText(value: unknown): string {
  return typeof value === 'number' && Number.isFinite(value) ? String(value) : ''
}

function readModalities(
  value: unknown,
  fallback: Record<Modality, boolean>,
): Record<Modality, boolean> {
  const record = asRecord(value)
  const out = { ...fallback }
  for (const modality of MODALITIES) {
    if (typeof record[modality] === 'boolean') out[modality] = record[modality] as boolean
  }
  return out
}

function readVariants(value: unknown): CustomVariantDraft[] {
  const record = asRecord(value)
  return Object.entries(record).map(([name, body]) => {
    const options = asRecord(body)
    const effort = options.reasoningEffort
    const rest = { ...options }
    delete rest.reasoningEffort
    return {
      name,
      reasoningEffort: typeof effort === 'string' && (REASONING_EFFORTS as readonly string[]).includes(effort)
        ? (effort as ReasoningEffort)
        : '',
      extraJson: Object.keys(rest).length > 0 ? JSON.stringify(rest, null, 2) : '',
    }
  })
}

function readHeaders(value: unknown): KeyValueDraft[] {
  const record = asRecord(value)
  return Object.entries(record).map(([name, headerValue]) => ({
    name,
    value: typeof headerValue === 'string' ? headerValue : String(headerValue ?? ''),
  }))
}

function readInterleaved(value: unknown): InterleavedMode {
  if (value === true) return 'reasoning_content'
  const field = asRecord(value).field
  if (field === 'reasoning_content' || field === 'reasoning_details') return field
  return 'none'
}

/**
 * Turns a stored `provider.<id>` block back into an editable draft.
 *
 * The block may have been written by this screen or by hand, so every field is
 * read defensively: a model with no `limit` still has to come back as a draft
 * that can be edited and saved, with the missing numbers blank rather than
 * invented.
 */
/**
 * Reads one stored provider back into a form.
 *
 * The single reader, and it takes the entry rather than the document around it.
 * Two callers want this and they hold different things: the global
 * configuration is a merged document with a `provider` map, while a tenant's own
 * declaration is already the entry. Splitting the lookup from the reading keeps
 * the part that actually has to be right - modalities, interleaved mode, the
 * variant's effort versus its leftovers - in one place instead of two copies
 * free to disagree about it.
 */
export function customProviderDraftFromEntry(
  providerId: string,
  stored: unknown,
): CustomProviderDraft {
  const entry = asRecord(stored)
  const baseUrl = asString(entry.api) || asString(asRecord(entry.options).baseURL)
  const models = asRecord(entry.models)

  const drafts: CustomModelDraft[] = Object.entries(models).map(([id, value]) => {
    const model = asRecord(value)
    const limit = asRecord(model.limit)
    const capabilities = asRecord(model.capabilities)
    const cost = asRecord(model.cost)
    const cache = asRecord(cost.cache)
    const inputDefaults = defaultModalities()
    const outputDefaults = defaultModalities()

    return {
      id,
      name: asString(model.name),
      family: asString(model.family),
      status: (MODEL_STATUSES as readonly string[]).includes(asString(model.status))
        ? (asString(model.status) as ModelStatus)
        : '',
      releaseDate: asString(model.release_date),
      contextLimit: numberToText(limit.context),
      inputLimit: numberToText(limit.input),
      outputLimit: numberToText(limit.output),
      temperature: asBoolean(capabilities.temperature, true),
      reasoning: asBoolean(capabilities.reasoning, false),
      attachment: asBoolean(capabilities.attachment, false),
      toolcall: asBoolean(capabilities.toolcall, true),
      inputModalities: readModalities(capabilities.input, inputDefaults),
      outputModalities: readModalities(capabilities.output, outputDefaults),
      interleaved: readInterleaved(capabilities.interleaved),
      costInput: numberToText(cost.input),
      costOutput: numberToText(cost.output),
      costCacheRead: numberToText(cache.read),
      costCacheWrite: numberToText(cache.write),
      variants: readVariants(model.variants),
      headers: readHeaders(model.headers),
      optionsJson:
        Object.keys(asRecord(model.options)).length > 0
          ? JSON.stringify(asRecord(model.options), null, 2)
          : '',
    }
  })

  return {
    providerId,
    name: asString(entry.name),
    kind: entry.npm ? 'npm' : 'api',
    baseUrl,
    npm: asString(entry.npm),
    models: drafts.length > 0 ? drafts : [emptyCustomModelDraft()],
  }
}

/**
 * The same reader, for a provider sitting in the server-wide configuration.
 *
 * A miss is a blank form rather than a throw: this is what an editor opens on,
 * and "create" arrives here with an id that is not in the document yet.
 */
export function customProviderDraftFromConfig(
  providerId: string,
  config: Record<string, unknown> | undefined,
): CustomProviderDraft {
  return customProviderDraftFromEntry(providerId, asRecord(config?.provider)[providerId])
}
