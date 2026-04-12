import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useCallback, useEffect, useMemo } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'

const modelFormSchema = z.object({
  providerId: z.string().min(1, 'Provider is required'),
  modelId: z.string().min(1, 'Model ID is required').regex(/^[a-zA-Z0-9_-]+$/, 'Must be alphanumeric with hyphens/underscores'),
  name: z.string().min(1, 'Display name is required'),
  contextLimit: z.number().min(0).optional(),
  outputLimit: z.number().min(0).optional(),
  createNewProvider: z.boolean(),
  newProviderType: z.enum(['api', 'npm']),
  newProviderId: z.string(),
  newProviderName: z.string().optional(),
  newProviderBaseUrl: z.string().optional(),
  newProviderNpm: z.string().optional(),
}).superRefine((data, ctx) => {
  if (data.createNewProvider) {
    if (!data.newProviderId?.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Provider ID is required when creating a new provider',
        path: ['newProviderId'],
      })
    } else if (!/^[a-z0-9-]+$/.test(data.newProviderId)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Must be lowercase letters, numbers, and hyphens only',
        path: ['newProviderId'],
      })
    }
    if (data.newProviderType === 'api' && !data.newProviderBaseUrl?.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Base URL is required for API providers',
        path: ['newProviderBaseUrl'],
      })
    }
    if (data.newProviderType === 'npm' && !data.newProviderNpm?.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'NPM package is required for npm providers',
        path: ['newProviderNpm'],
      })
    }
  }
})

type ModelFormValues = z.infer<typeof modelFormSchema>

interface ConfigModel {
  name?: string
  limit?: {
    context?: number
    output?: number
  }
  [key: string]: unknown
}

interface ConfigProvider {
  name?: string
  npm?: string
  api?: string
  options?: Record<string, unknown>
  models?: Record<string, ConfigModel>
  [key: string]: unknown
}

export interface NewProviderConfig {
  id: string
  type: 'api' | 'npm'
  name?: string
  baseUrl?: string
  npm?: string
}

interface OpenCodeModelDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSubmit: (providerId: string, modelId: string, model: ConfigModel, newProvider?: NewProviderConfig) => void
  availableProviders: string[]
  existingProviders?: Record<string, ConfigProvider>
  selectedProviderId: string
  editingModel?: {
    providerId: string
    modelId: string
    model: ConfigModel
  }
}

export function OpenCodeModelDialog({
  open,
  onOpenChange,
  onSubmit,
  availableProviders,
  existingProviders,
  selectedProviderId,
  editingModel,
}: OpenCodeModelDialogProps) {
  const getDefaultValues = useCallback((): ModelFormValues => {
    if (editingModel) {
      return {
        providerId: editingModel.providerId,
        modelId: editingModel.modelId,
        name: editingModel.model.name || '',
        contextLimit: editingModel.model.limit?.context,
        outputLimit: editingModel.model.limit?.output,
        createNewProvider: false,
        newProviderType: 'api' as const,
        newProviderId: '',
        newProviderName: '',
        newProviderBaseUrl: '',
        newProviderNpm: '',
      }
    }
    return {
      providerId: selectedProviderId || availableProviders[0] || '',
      modelId: '',
      name: '',
      contextLimit: undefined,
      outputLimit: undefined,
      createNewProvider: availableProviders.length === 0,
      newProviderType: 'api' as const,
      newProviderId: '',
      newProviderName: '',
      newProviderBaseUrl: '',
      newProviderNpm: '',
    }
  }, [editingModel, selectedProviderId, availableProviders])

  const form = useForm<ModelFormValues>({
    resolver: zodResolver(modelFormSchema),
    defaultValues: getDefaultValues(),
  })

  const createNewProvider = form.watch('createNewProvider')
  const newProviderType = form.watch('newProviderType')

  useEffect(() => {
    if (open) {
      form.reset(getDefaultValues())
    }
  }, [open, getDefaultValues, form])

  const handleSubmit = (values: ModelFormValues) => {
    const model: ConfigModel = {
      name: values.name,
    }

    if (values.contextLimit !== undefined || values.outputLimit !== undefined) {
      model.limit = {}
      if (values.contextLimit !== undefined) {
        model.limit.context = values.contextLimit
      }
      if (values.outputLimit !== undefined) {
        model.limit.output = values.outputLimit
      }
    }

    let newProvider: NewProviderConfig | undefined
    if (values.createNewProvider) {
      newProvider = {
        id: values.newProviderId,
        type: values.newProviderType,
        name: values.newProviderName || undefined,
        baseUrl: values.newProviderBaseUrl || undefined,
        npm: values.newProviderNpm || undefined,
      }
    }

    if (newProvider) {
      onSubmit(values.providerId, values.modelId, model, newProvider)
    } else {
      onSubmit(values.providerId, values.modelId, model)
    }
    form.reset()
    onOpenChange(false)
  }

  const handleOpenChange = (isOpen: boolean) => {
    if (!isOpen) {
      form.reset()
    }
    onOpenChange(isOpen)
  }

  const providerOptions = useMemo(() => {
    return availableProviders.map((p: string) => ({
      value: p,
      label: existingProviders?.[p]?.name || p,
    }))
  }, [availableProviders, existingProviders])

  const isEditing = !!editingModel

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent mobileFullscreen className="sm:max-w-2xl sm:max-h-[85vh] gap-0 flex flex-col p-0 md:p-6">
        <DialogHeader className="p-4 sm:p-6 border-b flex flex-row items-center justify-between space-y-0">
          <DialogTitle>{isEditing ? 'Edit Model' : 'Create Model'}</DialogTitle>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto p-2 sm:p-4" onClick={(e) => e.stopPropagation()} onPointerDown={(e) => e.stopPropagation()}>
          <Form {...form}>
            <div className="space-y-4">
              {!isEditing && (
                <FormField
                  control={form.control}
                  name="createNewProvider"
                  render={({ field }) => (
                    <FormItem className="flex flex-row items-center justify-between rounded-lg border p-3 shadow-sm">
                      <div className="space-y-0.5">
                        <FormLabel>Create new provider</FormLabel>
                        <p className="text-xs text-muted-foreground">
                          Add a new provider configuration
                        </p>
                      </div>
                      <FormControl>
                        <Switch
                          checked={field.value}
                          onCheckedChange={field.onChange}
                        />
                      </FormControl>
                    </FormItem>
                  )}
                />
              )}

              {createNewProvider ? (
                <div className="space-y-4 border rounded-lg p-4 bg-muted/30">
                  <h4 className="text-sm font-medium">New Provider</h4>

                  <FormField
                    control={form.control}
                    name="newProviderType"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Provider Type</FormLabel>
                        <Select onValueChange={field.onChange} defaultValue={field.value}>
                          <FormControl>
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            <SelectItem value="api">API (HTTP endpoint)</SelectItem>
                            <SelectItem value="npm">NPM Package</SelectItem>
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="newProviderId"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Provider ID</FormLabel>
                        <FormControl>
                          <Input
                            {...field}
                            placeholder="e.g., my-provider"
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="newProviderName"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Display Name (optional)</FormLabel>
                        <FormControl>
                          <Input
                            {...field}
                            placeholder="e.g., My Provider"
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  {newProviderType === 'api' && (
                    <FormField
                      control={form.control}
                      name="newProviderBaseUrl"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Base URL</FormLabel>
                          <FormControl>
                            <Input
                              {...field}
                              placeholder="e.g., https://api.openai.com/v1"
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  )}

                  {newProviderType === 'npm' && (
                    <FormField
                      control={form.control}
                      name="newProviderNpm"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>NPM Package</FormLabel>
                          <FormControl>
                            <Input
                              {...field}
                              placeholder="e.g., @modelcontextprotocol/server-filesystem"
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  )}
                </div>
              ) : (
                <FormField
                  control={form.control}
                  name="providerId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Provider</FormLabel>
                      <Select
                        onValueChange={field.onChange}
                        defaultValue={field.value}
                        disabled={isEditing}
                      >
                        <FormControl>
                          <SelectTrigger className={isEditing ? 'bg-muted' : ''}>
                            <SelectValue placeholder="Select provider" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {providerOptions.map(option => (
                            <SelectItem key={option.value} value={option.value}>
                              {option.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              )}

              <FormField
                control={form.control}
                name="modelId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Model ID</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        placeholder="e.g., gpt-4o, claude-3-opus"
                        disabled={isEditing}
                        className={isEditing ? 'bg-muted' : ''}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Display Name</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        placeholder="e.g., GPT-4o, Claude 3 Opus"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="contextLimit"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Context Limit</FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          type="number"
                          min="0"
                          placeholder="e.g., 128000"
                          value={field.value ?? ''}
                          onChange={(e) => {
                            const val = e.target.value
                            field.onChange(val ? parseInt(val, 10) : undefined)
                          }}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="outputLimit"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Output Limit</FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          type="number"
                          min="0"
                          placeholder="e.g., 4096"
                          value={field.value ?? ''}
                          onChange={(e) => {
                            const val = e.target.value
                            field.onChange(val ? parseInt(val, 10) : undefined)
                          }}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            </div>
          </Form>
        </div>

        <DialogFooter className="p-3 sm:p-4 border-t gap-2 pb-4">
          <Button
            variant="outline"
            onClick={() => handleOpenChange(false)}
            className="flex-1 sm:flex-none"
          >
            Cancel
          </Button>
          <Button
            onClick={() => form.handleSubmit(handleSubmit)()}
            disabled={!form.formState.isValid}
            className="flex-1 sm:flex-none"
          >
            {isEditing ? 'Update' : 'Create'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}