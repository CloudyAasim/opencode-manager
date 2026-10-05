import { useEffect } from 'react'
import { useFieldArray, useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Dialog, DialogContent, DialogFooter } from '@/components/ui/dialog'
import { DialogLayout } from '@/components/ui/dialog-layout'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Checkbox } from '@/components/ui/checkbox'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Loader2, Plus, Trash2 } from 'lucide-react'
import { useI18n } from '@/lib/i18n'
import {
  INTERLEAVED_MODES,
  MODALITIES,
  MODEL_STATUSES,
  REASONING_EFFORTS,
  customModelFormSchema,
  emptyCustomModelDraft,
  type CustomModelDraft,
  type CustomModelFormValues,
  type Modality,
} from './custom-provider'

export const CUSTOM_MODEL_FORM_ID = 'custom-model-form'

/** Radix cannot render an empty SelectItem, so "unset" gets a real value. */
const NO_EFFORT = 'none'
const NO_STATUS = 'none'

interface CustomModelDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSubmit: (model: CustomModelDraft) => void
  /** Set when editing; the id is then fixed rather than chosen. */
  existingModelId?: string
  /** What to open with. Blank when absent, so a create never inherits a draft. */
  initialModel?: CustomModelDraft
  isSubmitting?: boolean
  error?: string | null
}

export function CustomModelDialog({
  open,
  onOpenChange,
  onSubmit,
  existingModelId,
  initialModel,
  isSubmitting = false,
  error,
}: CustomModelDialogProps) {
  const { t } = useI18n()
  const form = useForm<CustomModelFormValues>({
    resolver: zodResolver(customModelFormSchema),
    defaultValues: emptyCustomModelDraft(),
  })
  const variants = useFieldArray({ control: form.control, name: 'variants' })
  const headers = useFieldArray({ control: form.control, name: 'headers' })
  const reasoning = form.watch('reasoning')
  const temperature = form.watch('temperature')

  // Reopening has to start from whatever this dialog was opened for. Left
  // alone the previous attempt's values - and its validation messages - were
  // still there, which is how editing a model used to start from the last one.
  useEffect(() => {
    if (!open) return
    form.reset(initialModel ? { ...initialModel, variants: [...initialModel.variants], headers: [...initialModel.headers] } : emptyCustomModelDraft())
  }, [open, initialModel, form])

  const handleSubmit = form.handleSubmit((values) => {
    onSubmit({
      ...values,
      id: values.id.trim(),
      name: values.name.trim(),
      family: values.family.trim(),
      releaseDate: values.releaseDate.trim(),
      contextLimit: values.contextLimit.trim(),
      inputLimit: values.inputLimit.trim(),
      outputLimit: values.outputLimit.trim(),
      costInput: values.costInput.trim(),
      costOutput: values.costOutput.trim(),
      costCacheRead: values.costCacheRead.trim(),
      costCacheWrite: values.costCacheWrite.trim(),
      variants: values.variants.map((row) => ({ ...row, name: row.name.trim(), extraJson: row.extraJson.trim() })),
      headers: values.headers.map((row) => ({ name: row.name.trim(), value: row.value })),
      optionsJson: values.optionsJson.trim(),
    })
  })

  const toggle = (group: 'inputModalities' | 'outputModalities') => (modality: Modality) =>
    form.setValue(`${group}.${modality}`, !form.getValues(`${group}.${modality}`), {
      shouldDirty: true,
      shouldValidate: true,
    })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[85vh] flex flex-col">
        <DialogLayout title={t('settingsPanels.customModel.title')}>
          <form
            id={CUSTOM_MODEL_FORM_ID}
            onSubmit={handleSubmit}
            className="space-y-6 py-2 overflow-y-auto"
            noValidate
          >
            <p className="text-sm text-muted-foreground">
              {t('settingsPanels.customModel.description')}
            </p>

            <section className="space-y-3">
              <h3 className="text-sm font-medium">{t('settingsPanels.customModel.sections.identity')}</h3>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label htmlFor="custom-model-id">{t('settingsPanels.customModel.fields.modelId')}</Label>
                  <Input
                    id="custom-model-id"
                    placeholder="gpt-4o"
                    autoComplete="off"
                    readOnly={Boolean(existingModelId)}
                    {...form.register('id')}
                  />
                  <p className="text-xs text-muted-foreground">
                    {t('settingsPanels.customModel.fields.modelIdHint')}
                  </p>
                  <FieldError message={form.formState.errors.id?.message} />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="custom-model-name">{t('settingsPanels.customModel.fields.modelName')}</Label>
                  <Input id="custom-model-name" placeholder="GPT-4o" autoComplete="off" {...form.register('name')} />
                  <FieldError message={form.formState.errors.name?.message} />
                </div>
                <div className="space-y-1">
                  <Label>{t('settingsPanels.customModel.fields.family')}</Label>
                  <Input placeholder="gpt" autoComplete="off" {...form.register('family')} />
                  <FieldError message={form.formState.errors.family?.message} />
                </div>
                <div className="space-y-1">
                  <Label>{t('settingsPanels.customModel.fields.status')}</Label>
                  <Select
                    value={form.watch('status') || NO_STATUS}
                    onValueChange={(value) =>
                      form.setValue('status', value === NO_STATUS ? '' : (value as CustomModelFormValues['status']), {
                        shouldDirty: true,
                      })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NO_STATUS}>{t('settingsPanels.customModel.status.none')}</SelectItem>
                      {MODEL_STATUSES.map((status) => (
                        <SelectItem key={status} value={status}>
                          {t(`settingsPanels.customModel.status.${status}`)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FieldError message={form.formState.errors.status?.message} />
                </div>
                <div className="space-y-1">
                  <Label>{t('settingsPanels.customModel.fields.releaseDate')}</Label>
                  <Input placeholder="2024-11-20" autoComplete="off" {...form.register('releaseDate')} />
                  <FieldError message={form.formState.errors.releaseDate?.message} />
                </div>
              </div>
            </section>

            <section className="space-y-3">
              <h3 className="text-sm font-medium">{t('settingsPanels.customModel.sections.limits')}</h3>
              <p className="text-xs text-muted-foreground">
                {t('settingsPanels.customModel.limitsHint')}
              </p>
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="space-y-1">
                  <Label htmlFor="custom-model-context">
                    {t('settingsPanels.customModel.fields.contextLimit')}
                  </Label>
                  <Input
                    id="custom-model-context"
                    type="number"
                    min={0}
                    step={1}
                    placeholder="128000"
                    {...form.register('contextLimit')}
                  />
                  <FieldError message={form.formState.errors.contextLimit?.message} />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="custom-model-output">
                    {t('settingsPanels.customModel.fields.outputLimit')}
                  </Label>
                  <Input
                    id="custom-model-output"
                    type="number"
                    min={0}
                    step={1}
                    placeholder="16384"
                    {...form.register('outputLimit')}
                  />
                  <FieldError message={form.formState.errors.outputLimit?.message} />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="custom-model-input">
                    {t('settingsPanels.customModel.fields.inputLimit')}
                  </Label>
                  <Input id="custom-model-input" type="number" min={0} step={1} {...form.register('inputLimit')} />
                  <FieldError message={form.formState.errors.inputLimit?.message} />
                </div>
              </div>
            </section>

            <section className="space-y-3">
              <h3 className="text-sm font-medium">{t('settingsPanels.customModel.sections.capabilities')}</h3>
              <div className="grid gap-2 sm:grid-cols-2">
                <CapabilityToggle
                  label={t('settingsPanels.customModel.fields.temperature')}
                  hint={t('settingsPanels.customModel.hints.temperature')}
                  checked={temperature}
                  onChange={(checked) => form.setValue('temperature', checked, { shouldDirty: true })}
                />
                <CapabilityToggle
                  label={t('settingsPanels.customModel.fields.reasoning')}
                  hint={t('settingsPanels.customModel.hints.reasoning')}
                  checked={reasoning}
                  onChange={(checked) => form.setValue('reasoning', checked, { shouldDirty: true })}
                />
                <CapabilityToggle
                  label={t('settingsPanels.customModel.fields.toolcall')}
                  hint={t('settingsPanels.customModel.hints.toolcall')}
                  checked={form.watch('toolcall')}
                  onChange={(checked) => form.setValue('toolcall', checked, { shouldDirty: true })}
                />
                <CapabilityToggle
                  label={t('settingsPanels.customModel.fields.attachment')}
                  hint={t('settingsPanels.customModel.hints.attachment')}
                  checked={form.watch('attachment')}
                  onChange={(checked) => form.setValue('attachment', checked, { shouldDirty: true })}
                />
              </div>

              <div className="grid gap-3 pt-1 sm:grid-cols-2">
                <ModalityGroup
                  legend={t('settingsPanels.customModel.fields.inputModalities')}
                  values={form.watch('inputModalities')}
                  onToggle={toggle('inputModalities')}
                />
                <ModalityGroup
                  legend={t('settingsPanels.customModel.fields.outputModalities')}
                  values={form.watch('outputModalities')}
                  onToggle={toggle('outputModalities')}
                />
              </div>

              {reasoning && (
                <div className="max-w-xs space-y-1">
                  <Label>{t('settingsPanels.customModel.fields.interleaved')}</Label>
                  <Select
                    value={form.watch('interleaved')}
                    onValueChange={(value) =>
                      form.setValue('interleaved', value as CustomModelFormValues['interleaved'], {
                        shouldDirty: true,
                      })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {INTERLEAVED_MODES.map((mode) => (
                        <SelectItem key={mode} value={mode}>
                          {t(`settingsPanels.customModel.interleaved.${mode}`)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    {t('settingsPanels.customModel.hints.interleaved')}
                  </p>
                </div>
              )}
            </section>

            <section className="space-y-3">
              <h3 className="text-sm font-medium">{t('settingsPanels.customModel.sections.thinking')}</h3>
              <p className="text-xs text-muted-foreground">
                {t('settingsPanels.customModel.thinkingHint')}
              </p>
              <FieldError message={form.formState.errors.variants?.root?.message} />
              <div className="space-y-2">
                {variants.fields.map((field, index) => (
                  <div key={field.id} className="space-y-2 rounded-md border border-border p-3">
                    <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
                      <div className="space-y-1">
                        <Label>{t('settingsPanels.customModel.fields.variantName')}</Label>
                        <Input
                          placeholder="high"
                          autoComplete="off"
                          {...form.register(`variants.${index}.name` as const)}
                        />
                        <FieldError message={form.formState.errors.variants?.[index]?.name?.message} />
                      </div>
                      <div className="space-y-1">
                        <Label>{t('settingsPanels.customModel.fields.reasoningEffort')}</Label>
                        <Select
                          value={form.watch(`variants.${index}.reasoningEffort`) || NO_EFFORT}
                          onValueChange={(value) =>
                            form.setValue(
                              `variants.${index}.reasoningEffort`,
                              value === NO_EFFORT ? '' : (value as CustomModelFormValues['variants'][number]['reasoningEffort']),
                              { shouldDirty: true },
                            )
                          }
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value={NO_EFFORT}>
                              {t('settingsPanels.customModel.reasoningEffort.none')}
                            </SelectItem>
                            {REASONING_EFFORTS.map((effort) => (
                              <SelectItem key={effort} value={effort}>
                                {effort}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="self-end"
                        aria-label={t('settingsPanels.customModel.actions.removeThinkingLevel')}
                        onClick={() => variants.remove(index)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                    <div className="space-y-1">
                      <Label>{t('settingsPanels.customModel.fields.variantOptions')}</Label>
                      <Textarea
                        rows={2}
                        placeholder={'{\n  "thinkingBudgetTokens": 8000\n}'}
                        className="font-mono text-xs"
                        {...form.register(`variants.${index}.extraJson` as const)}
                      />
                      <FieldError message={form.formState.errors.variants?.[index]?.extraJson?.message} />
                    </div>
                  </div>
                ))}
              </div>
              <Button type="button" variant="outline" size="sm" onClick={() => variants.append({ name: '', reasoningEffort: '', extraJson: '' })}>
                <Plus className="h-4 w-4 mr-1" />
                {t('settingsPanels.customModel.actions.addThinkingLevel')}
              </Button>
            </section>

            <section className="space-y-3">
              <h3 className="text-sm font-medium">{t('settingsPanels.customModel.sections.cost')}</h3>
              <p className="text-xs text-muted-foreground">{t('settingsPanels.customModel.costHint')}</p>
              <div className="grid gap-3 sm:grid-cols-4">
                <div className="space-y-1">
                  <Label htmlFor="custom-model-cost-in">{t('settingsPanels.customModel.fields.costInput')}</Label>
                  <Input id="custom-model-cost-in" type="number" min={0} step="any" placeholder="2.5" {...form.register('costInput')} />
                  <FieldError message={form.formState.errors.costInput?.message} />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="custom-model-cost-out">{t('settingsPanels.customModel.fields.costOutput')}</Label>
                  <Input id="custom-model-cost-out" type="number" min={0} step="any" placeholder="10" {...form.register('costOutput')} />
                  <FieldError message={form.formState.errors.costOutput?.message} />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="custom-model-cost-cr">{t('settingsPanels.customModel.fields.costCacheRead')}</Label>
                  <Input id="custom-model-cost-cr" type="number" min={0} step="any" {...form.register('costCacheRead')} />
                  <FieldError message={form.formState.errors.costCacheRead?.message} />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="custom-model-cost-cw">{t('settingsPanels.customModel.fields.costCacheWrite')}</Label>
                  <Input id="custom-model-cost-cw" type="number" min={0} step="any" {...form.register('costCacheWrite')} />
                  <FieldError message={form.formState.errors.costCacheWrite?.message} />
                </div>
              </div>
            </section>

            <section className="space-y-3">
              <h3 className="text-sm font-medium">{t('settingsPanels.customModel.sections.advanced')}</h3>
              <div className="space-y-2">
                <Label>{t('settingsPanels.customModel.fields.headers')}</Label>
                {headers.fields.map((field, index) => (
                  <div key={field.id} className="space-y-1">
                    <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
                      <Input
                        placeholder="X-Title"
                        autoComplete="off"
                        {...form.register(`headers.${index}.name` as const)}
                      />
                      <Input placeholder="value" autoComplete="off" {...form.register(`headers.${index}.value` as const)} />
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        aria-label={t('settingsPanels.customModel.actions.removeHeader')}
                        onClick={() => headers.remove(index)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                    <FieldError message={form.formState.errors.headers?.[index]?.name?.message} />
                  </div>
                ))}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => headers.append({ name: '', value: '' })}
                >
                  <Plus className="h-4 w-4 mr-1" />
                  {t('settingsPanels.customModel.actions.addHeader')}
                </Button>
              </div>
              <div className="space-y-1">
                <Label htmlFor="custom-model-options">{t('settingsPanels.customModel.fields.modelOptions')}</Label>
                <Textarea
                  id="custom-model-options"
                  rows={3}
                  placeholder={'{\n  "top_p": 0.9\n}'}
                  className="font-mono text-xs"
                  {...form.register('optionsJson')}
                />
                <FieldError message={form.formState.errors.optionsJson?.message} />
              </div>
            </section>

            {error && <p className="text-sm text-destructive">{error}</p>}
          </form>
        </DialogLayout>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={isSubmitting}>
            {t('misc.common.cancel')}
          </Button>
          <Button type="submit" form={CUSTOM_MODEL_FORM_ID} disabled={isSubmitting}>
            {isSubmitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            {isSubmitting
              ? t('settingsPanels.customModel.actions.saving')
              : t('settingsPanels.customModel.actions.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function FieldError({ message }: { message?: string }) {
  if (!message) return null
  return <p className="text-xs font-medium text-destructive">{message}</p>
}

function CapabilityToggle({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string
  hint: string
  checked: boolean
  onChange: (checked: boolean) => void
}) {
  return (
    <label className="flex cursor-pointer items-start gap-2 rounded-md border border-border p-2">
      <Checkbox checked={checked} onCheckedChange={(value) => onChange(value === true)} className="mt-0.5" />
      <span className="min-w-0">
        <span className="block text-sm">{label}</span>
        <span className="block text-xs text-muted-foreground">{hint}</span>
      </span>
    </label>
  )
}

function ModalityGroup({
  legend,
  values,
  onToggle,
}: {
  legend: string
  values: Record<Modality, boolean>
  onToggle: (modality: Modality) => void
}) {
  const { t } = useI18n()
  return (
    <fieldset className="space-y-1.5 rounded-md border border-border p-3">
      <legend className="px-1 text-xs font-medium text-muted-foreground">{legend}</legend>
      <div className="flex flex-wrap gap-3">
        {MODALITIES.map((modality) => (
          <label key={modality} className="flex cursor-pointer items-center gap-1.5 text-sm">
            <Checkbox checked={values[modality]} onCheckedChange={() => onToggle(modality)} />
            {t(`settingsPanels.customModel.modality.${modality}`)}
          </label>
        ))}
      </div>
    </fieldset>
  )
}
