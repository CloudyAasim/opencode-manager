import { useEffect } from 'react'
import { useFieldArray, useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Dialog, DialogContent, DialogFooter } from '@/components/ui/dialog'
import { DialogLayout } from '@/components/ui/dialog-layout'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Loader2, Plus, Trash2 } from 'lucide-react'
import { useI18n } from '@/lib/i18n'
import {
  conflictingProviderId,
  customProviderFormSchema,
  emptyCustomProviderDraft,
  type CustomProviderDraft,
  type CustomProviderFormValues,
} from './custom-provider'

interface CustomProviderDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Ids already declared, so a create can never silently replace one. */
  existingProviderIds: string[]
  onSubmit: (draft: CustomProviderDraft) => void
  isSubmitting?: boolean
  error?: string | null
}

/** The submit button lives in the footer, outside the form element. */
const CUSTOM_PROVIDER_FORM_ID = 'custom-provider-form'

export function CustomProviderDialog({
  open,
  onOpenChange,
  existingProviderIds,
  onSubmit,
  isSubmitting = false,
  error,
}: CustomProviderDialogProps) {
  const { t } = useI18n()
  const form = useForm<CustomProviderFormValues>({
    resolver: zodResolver(customProviderFormSchema),
    defaultValues: emptyCustomProviderDraft(),
  })
  const { fields, append, remove } = useFieldArray({ control: form.control, name: 'models' })
  const kind = form.watch('kind')
  const providerId = form.watch('providerId')

  // Reopening has to start from a blank form. Left alone the previous attempt's
  // values - and its validation messages - were still there.
  useEffect(() => {
    if (open) form.reset(emptyCustomProviderDraft())
  }, [open, form])

  const handleSubmit = form.handleSubmit((values) => {
    // Checked again here, not only in the schema: the id is free text, and the
    // list it is checked against can change while the dialog is open.
    if (conflictingProviderId(values, existingProviderIds)) return
    onSubmit({
      providerId: values.providerId.trim(),
      name: values.name?.trim() || undefined,
      kind: values.kind,
      baseUrl: values.baseUrl?.trim() || undefined,
      npm: values.npm?.trim() || undefined,
      models: values.models.map((row) => ({ id: row.id.trim(), name: row.name?.trim() || undefined })),
    })
  })

  const alreadyDeclared = conflictingProviderId({ providerId }, existingProviderIds)

  // `errors.models` is either the array of per-row errors or a single error
  // aimed at the list itself, and the two have different shapes. Reaching for
  // `.message` without asking which one it is does not typecheck.
  const modelsRootError = form.formState.errors.models
  const modelsErrorMessage =
    modelsRootError && !Array.isArray(modelsRootError) ? modelsRootError.message : undefined

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[85vh] flex flex-col">
        <DialogLayout title={t('settingsPanels.customProvider.title')}>
          <Form {...form}>
            <form id={CUSTOM_PROVIDER_FORM_ID} onSubmit={handleSubmit} className="space-y-4 py-2" noValidate>
              <p className="text-sm text-muted-foreground">
                {t('settingsPanels.customProvider.description')}
              </p>

              <div className="space-y-2">
                <FormField
                  control={form.control}
                  name="providerId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t('settingsPanels.customProvider.fields.providerId')}</FormLabel>
                      <FormControl>
                        <Input {...field} placeholder="my-provider" autoComplete="off" />
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
              </div>

              <div className="space-y-2">
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

              <div className="grid gap-4 sm:grid-cols-2">
                <FormField
                  control={form.control}
                  name="kind"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t('settingsPanels.customProvider.fields.kind')}</FormLabel>
                      <Select value={field.value} onValueChange={field.onChange}>
                        <FormControl>
                          {/* Radix's own trigger already renders
                              `<button type="button">`, so this one cannot
                              submit the form. Nothing to add here. */}
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

                {kind === 'npm' ? (
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
                ) : (
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
                )}
              </div>

              <div className="space-y-2">
                <Label>{t('settingsPanels.customProvider.fields.models')}</Label>
                <div className="space-y-2">
                  {fields.map((field, index) => (
                    <div key={field.id} className="flex items-start gap-2">
                      <div className="flex-1 space-y-2">
                        <FormField
                          control={form.control}
                          name={`models.${index}.id`}
                          render={({ field: modelField }) => (
                            <FormItem>
                              <FormControl>
                                <Input
                                  {...modelField}
                                  aria-label={t('settingsPanels.customProvider.fields.modelId')}
                                  placeholder="model-id"
                                  autoComplete="off"
                                />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                        <FormField
                          control={form.control}
                          name={`models.${index}.name`}
                          render={({ field: modelField }) => (
                            <FormItem>
                              <FormControl>
                                <Input
                                  {...modelField}
                                  aria-label={t('settingsPanels.customProvider.fields.modelName')}
                                  placeholder={t('settingsPanels.customProvider.fields.modelNameOptional')}
                                  autoComplete="off"
                                />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="mt-1 shrink-0"
                        aria-label={t('settingsPanels.customProvider.actions.removeModel')}
                        onClick={() => remove(index)}
                        disabled={fields.length === 1}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  ))}
                </div>
                <Button type="button" variant="outline" size="sm" onClick={() => append({ id: '', name: '' })}>
                  <Plus className="h-4 w-4 mr-1" />
                  {t('settingsPanels.customProvider.actions.addModel')}
                </Button>
                {modelsErrorMessage && (
                  // Not a `FormMessage`: that one reads the field context off a
                  // `FormField`, and this error belongs to the list rather than
                  // to any one row.
                  <p className="text-sm font-medium text-destructive">{modelsErrorMessage}</p>
                )}
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
              ? t('settingsPanels.customProvider.actions.creating')
              : t('settingsPanels.customProvider.actions.create')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
