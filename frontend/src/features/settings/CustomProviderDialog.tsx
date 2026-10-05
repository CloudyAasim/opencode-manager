import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Dialog, DialogContent, DialogFooter } from '@/components/ui/dialog'
import { DialogLayout } from '@/components/ui/dialog-layout'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form'
import { Loader2, Pencil, Plus, Trash2 } from 'lucide-react'
import { useI18n } from '@/lib/i18n'
import { CustomModelDialog } from './CustomModelDialog'
import {
  conflictingProviderId,
  customProviderFormSchema,
  type CustomModelDraft,
  type CustomProviderDraft,
  type CustomProviderFormValues,
} from './custom-provider'

export const CUSTOM_PROVIDER_FORM_ID = 'custom-provider-form'

interface CustomProviderDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Ids already declared, so a create can never silently replace one. */
  existingProviderIds: string[]
  /** What to open with. Blank when absent, so a create starts empty. */
  initialDraft?: CustomProviderDraft
  /** The id being edited. Fixed while editing; a create refuses to collide. */
  editingProviderId?: string
  onSubmit: (draft: CustomProviderDraft) => void
  isSubmitting?: boolean
  error?: string | null
}

/** One line of the model list, derived so the list never disagrees with the draft. */
function summarize(model: CustomModelDraft, t: (key: string) => string) {
  const badges: string[] = []
  if (model.reasoning) badges.push(t('settingsPanels.customModel.badges.reasoning'))
  if (model.toolcall) badges.push(t('settingsPanels.customModel.badges.toolcall'))
  if (model.attachment) badges.push(t('settingsPanels.customModel.badges.attachment'))
  if (model.inputModalities.image) badges.push(t('settingsPanels.customModel.badges.image'))
  return badges
}

export function CustomProviderDialog({
  open,
  onOpenChange,
  existingProviderIds,
  initialDraft,
  editingProviderId,
  onSubmit,
  isSubmitting = false,
  error,
}: CustomProviderDialogProps) {
  const { t } = useI18n()
  // `shouldUnregister: false` is said out loud because the endpoint and the npm
  // package are both mounted here - only one is visible - and a field that
  // unregisters comes back `undefined` rather than what was typed.
  const form = useForm<CustomProviderFormValues>({
    resolver: zodResolver(customProviderFormSchema),
    shouldUnregister: false,
    defaultValues: { providerId: '', name: '', kind: 'api', baseUrl: '', npm: '' },
  })
  const kind = form.watch('kind')
  const providerId = form.watch('providerId')

  const [models, setModels] = useState<CustomModelDraft[]>([])
  const [modelDialog, setModelDialog] = useState<{ open: boolean; index: number | null }>({
    open: false,
    index: null,
  })
  const [modelError, setModelError] = useState<string | null>(null)

  // Reopening has to start from whatever this dialog was opened for. Left alone
  // the previous attempt's values - and its validation messages - stayed, which
  // is how editing a provider used to start from the last one edited.
  useEffect(() => {
    if (!open) return
    form.reset({
      providerId: initialDraft?.providerId ?? '',
      name: initialDraft?.name ?? '',
      kind: initialDraft?.kind ?? 'api',
      baseUrl: initialDraft?.baseUrl ?? '',
      npm: initialDraft?.npm ?? '',
    })
    setModels(initialDraft?.models ?? [])
    setModelError(null)
  }, [open, initialDraft, form])

  // One mode, used by both the button and the submit guard. They used to
  // disagree - the button said 'edit' and the guard said 'create' - so an edit
  // of an existing provider had an enabled Save that silently did nothing.
  const mode = editingProviderId ? 'edit' : 'create'

  const alreadyDeclared = conflictingProviderId({ providerId }, existingProviderIds, mode)

  const handleSubmit = form.handleSubmit((values) => {
    // Checked again here, not only in the schema: the id is free text, and the
    // list it is checked against can change while the dialog is open.
    if (conflictingProviderId({ providerId: values.providerId }, existingProviderIds, mode)) return
    if (models.length === 0) {
      setModelError(t('settingsPanels.customProvider.errors.modelsRequired'))
      return
    }
    onSubmit({
      providerId: values.providerId.trim(),
      name: values.name.trim(),
      kind: values.kind,
      // Both fields stay mounted so neither loses its value, which means the
      // one that does not match `kind` is still holding whatever was last typed
      // in it. Only the matching one is written into the config block, but a
      // draft that still carries the other is a trap for whatever reads it next.
      baseUrl: values.kind === 'api' ? values.baseUrl.trim() : '',
      npm: values.kind === 'npm' ? values.npm.trim() : '',
      models,
    })
  })

  const commitModel = (model: CustomModelDraft) => {
    setModels((current) => {
      const next = [...current]
      if (modelDialog.index === null) next.push(model)
      else next[modelDialog.index] = model
      return next
    })
    setModelError(null)
    setModelDialog({ open: false, index: null })
  }

  const removeModel = (index: number) => {
    setModels((current) => current.filter((_, i) => i !== index))
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[85vh] flex flex-col">
        <DialogLayout title={t('settingsPanels.customProvider.title')}>
          <Form {...form}>
            <form
              id={CUSTOM_PROVIDER_FORM_ID}
              onSubmit={handleSubmit}
              className="space-y-5 py-2 overflow-y-auto"
              noValidate
            >
              <p className="text-sm text-muted-foreground">
                {t('settingsPanels.customProvider.description')}
              </p>

              <div className="grid gap-3 sm:grid-cols-2">
                <FormField
                  control={form.control}
                  name="providerId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t('settingsPanels.customProvider.fields.providerId')}</FormLabel>
                      <FormControl>
                        <Input {...field} placeholder="my-provider" autoComplete="off" readOnly={Boolean(editingProviderId)} />
                      </FormControl>
                      <p className="text-xs text-muted-foreground">
                        {t('settingsPanels.customProvider.fields.providerIdHint')}
                      </p>
                      {alreadyDeclared && (
                        <p className="text-xs text-destructive">
                          {t('settingsPanels.customProvider.errors.providerIdTaken', { id: alreadyDeclared })}
                        </p>
                      )}
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t('settingsPanels.customProvider.fields.name')}</FormLabel>
                      <FormControl>
                        <Input {...field} autoComplete="off" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <FormField
                  control={form.control}
                  name="kind"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t('settingsPanels.customProvider.fields.kind')}</FormLabel>
                      <Select
                        value={field.value}
                        onValueChange={field.onChange}
                      >
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="api">{t('settingsPanels.customProvider.fields.kindApi')}</SelectItem>
                          <SelectItem value="npm">{t('settingsPanels.customProvider.fields.kindNpm')}</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                {/*
                  Both stay mounted, and the irrelevant one is hidden rather
                  than unmounted. Unmounting made react-hook-form drop the
                  value: it came back as `undefined`, so choosing "npm
                  package" made every save fail with "expected string,
                  received undefined" on a field that was no longer on screen,
                  and switching away and back lost the endpoint URL. Only the
                  one that matches `kind` is written into the config block, so
                  the hidden field's value travels nowhere.
                */}
                <div hidden={kind !== 'npm'}>
                  <FormField
                    control={form.control}
                    name="npm"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t('settingsPanels.customProvider.fields.npm')}</FormLabel>
                        <FormControl>
                          <Input {...field} placeholder="@ai-sdk/openai-compatible" autoComplete="off" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
                <div hidden={kind !== 'api'}>
                  <FormField
                    control={form.control}
                    name="baseUrl"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t('settingsPanels.customProvider.fields.baseUrl')}</FormLabel>
                        <FormControl>
                          <Input {...field} placeholder="https://example.com/v1" autoComplete="off" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
              </div>

              <div className="space-y-2 border-t border-border pt-4">
                <div className="flex items-center justify-between gap-2">
                  <Label>{t('settingsPanels.customProvider.fields.models')}</Label>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setModelError(null)
                      setModelDialog({ open: true, index: null })
                    }}
                  >
                    <Plus className="h-4 w-4 mr-1" />
                    {t('settingsPanels.customProvider.actions.addModel')}
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  {t('settingsPanels.customProvider.modelsHint')}
                </p>

                {models.length === 0 ? (
                  <p className="rounded-md border border-dashed border-border px-3 py-4 text-center text-xs text-muted-foreground">
                    {t('settingsPanels.customProvider.noModels')}
                  </p>
                ) : (
                  <ul className="space-y-2">
                    {models.map((model, index) => (
                      <li key={`${model.id}-${index}`} className="space-y-1 rounded-md border border-border p-3">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium">{model.name || model.id}</p>
                            <p className="truncate font-mono text-xs text-muted-foreground">{model.id}</p>
                          </div>
                          <div className="flex shrink-0 gap-1">
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              aria-label={t('settingsPanels.customProvider.actions.editModel', { id: model.id })}
                              onClick={() => {
                                setModelError(null)
                                setModelDialog({ open: true, index })
                              }}
                            >
                              <Pencil className="h-4 w-4" />
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              aria-label={t('settingsPanels.customProvider.actions.removeModel', { id: model.id })}
                              onClick={() => removeModel(index)}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </div>
                        <p className="text-xs text-muted-foreground">
                          {t('settingsPanels.customModel.badges.limits', {
                            context: model.contextLimit || '—',
                            output: model.outputLimit || '—',
                          })}
                        </p>
                        {summarize(model, t).length > 0 && (
                          <div className="flex flex-wrap gap-1 pt-0.5">
                            {summarize(model, t).map((badge) => (
                              <Badge key={badge} variant="secondary" className="text-[10px]">
                                {badge}
                              </Badge>
                            ))}
                          </div>
                        )}
                      </li>
                    ))}
                  </ul>
                )}

                {modelError && <p className="text-sm font-medium text-destructive">{modelError}</p>}
              </div>

              <p className="text-xs text-muted-foreground border-l-2 border-muted-foreground/40 pl-3">
                {t('settingsPanels.customProvider.apiKeyNote')}
              </p>

              {error && <p className="text-sm text-destructive">{error}</p>}
            </form>
          </Form>
        </DialogLayout>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={isSubmitting}>
            {t('misc.common.cancel')}
          </Button>
          <Button
            type="submit"
            form={CUSTOM_PROVIDER_FORM_ID}
            disabled={isSubmitting || Boolean(alreadyDeclared)}
          >
            {isSubmitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            {isSubmitting
              ? t('settingsPanels.customProvider.actions.saving')
              : editingProviderId
                ? t('settingsPanels.customProvider.actions.save')
                : t('settingsPanels.customProvider.actions.create')}
          </Button>
        </DialogFooter>
      </DialogContent>

      <CustomModelDialog
        open={modelDialog.open}
        onOpenChange={(open) => setModelDialog((current) => ({ ...current, open }))}
        onSubmit={commitModel}
        existingModelId={modelDialog.index === null ? undefined : models[modelDialog.index]?.id}
        initialModel={modelDialog.index === null ? undefined : models[modelDialog.index]}
        error={modelError}
      />
    </Dialog>
  )
}
