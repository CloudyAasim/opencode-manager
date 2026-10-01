import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useMemo, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form'
import { Textarea } from '@/components/ui/textarea'
import { Switch } from '@/components/ui/switch'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Combobox, type ComboboxOption } from '@/components/ui/combobox'
import { useProvidersWithModels } from '@/hooks/useProvidersWithModels'
import { useI18n, i18n } from '@/lib/i18n'

const agentFormSchema = z.object({
  name: z.string().min(1, i18n.t('settingsPanels.agentDialog.errors.nameRequired')).regex(/^[a-z0-9-]+$/, i18n.t('settingsPanels.agentDialog.errors.nameFormat')),
  description: z.string().optional(),
  prompt: z.string().min(1, i18n.t('settingsPanels.agentDialog.errors.promptRequired')),
  mode: z.enum(['subagent', 'primary', 'all']),
  temperature: z.number().min(0).max(2),
  topP: z.number().min(0).max(1),
  modelId: z.string().optional(),
  providerId: z.string().optional(),
  write: z.boolean(),
  edit: z.boolean(),
  bash: z.boolean(),
  webfetch: z.boolean(),
  editPermission: z.enum(['ask', 'allow', 'deny']),
  bashPermission: z.enum(['ask', 'allow', 'deny']),
  webfetchPermission: z.enum(['ask', 'allow', 'deny']),
  disable: z.boolean()
})

type AgentFormValues = z.infer<typeof agentFormSchema>

interface Agent {
  prompt?: string
  description?: string
  mode?: 'subagent' | 'primary' | 'all'
  temperature?: number
  topP?: number
  top_p?: number
  model?: string
  tools?: Record<string, boolean>
  permission?: {
    edit?: 'ask' | 'allow' | 'deny'
    bash?: 'ask' | 'allow' | 'deny' | Record<string, 'ask' | 'allow' | 'deny'>
    webfetch?: 'ask' | 'allow' | 'deny'
  }
  disable?: boolean
  [key: string]: unknown
}

function parseModelString(model?: string): { providerId: string; modelId: string } {
  if (!model) return { providerId: '', modelId: '' }
  const [providerId, ...rest] = model.split('/')
  return { providerId: providerId || '', modelId: rest.join('/') || '' }
}

interface AgentDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSubmit: (name: string, agent: Agent) => void
  editingAgent?: { name: string; agent: Agent } | null
}

export function AgentDialog({ open, onOpenChange, onSubmit, editingAgent }: AgentDialogProps) {
  const { t } = useI18n()
  const { data: providers } = useProvidersWithModels({ enabled: open })

  const providerOptions: ComboboxOption[] = useMemo(() => {
    const sourceLabels: Record<string, string> = {
      configured: t('settingsPanels.agentDialog.sourceCustom'),
      local: t('settingsPanels.agentDialog.sourceLocal'),
      builtin: t('settingsPanels.agentDialog.sourceBuiltin'),
    }
    return providers.map(p => ({
      value: p.id,
      label: p.name || p.id,
      description: p.models.length > 0 ? t('settingsPanels.agentDialog.modelsCount', { count: p.models.length }) : undefined,
      group: sourceLabels[p.source] || t('settingsPanels.agentDialog.sourceOther'),
    }))
  }, [providers, t])

  const getDefaultValues = (agent?: { name: string; agent: Agent } | null): AgentFormValues => {
    const parsed = parseModelString(agent?.agent.model)
    return {
      name: agent?.name || '',
      description: agent?.agent.description || '',
      prompt: agent?.agent.prompt || '',
      mode: agent?.agent.mode || 'subagent',
      temperature: agent?.agent.temperature ?? 0.7,
      topP: agent?.agent.topP ?? agent?.agent.top_p ?? 1,
      modelId: parsed.modelId,
      providerId: parsed.providerId,
      write: agent?.agent.tools?.write ?? true,
      edit: agent?.agent.tools?.edit ?? true,
      bash: agent?.agent.tools?.bash ?? true,
      webfetch: agent?.agent.tools?.webfetch ?? true,
      editPermission: agent?.agent.permission?.edit ?? 'allow',
      bashPermission: typeof agent?.agent.permission?.bash === 'string' ? agent.agent.permission.bash : 'allow',
      webfetchPermission: agent?.agent.permission?.webfetch ?? 'allow',
      disable: agent?.agent.disable ?? false
    }
  }

  const form = useForm<AgentFormValues>({
    resolver: zodResolver(agentFormSchema),
    defaultValues: getDefaultValues(editingAgent)
  })

  useEffect(() => {
    if (open) {
      form.reset(getDefaultValues(editingAgent))
    }
  }, [open, editingAgent, form])

  const selectedProviderId = form.watch('providerId')

  const modelOptions: ComboboxOption[] = useMemo(() => {
    const selectedProvider = providers.find(p => p.id === selectedProviderId)
    if (selectedProvider && selectedProvider.models.length > 0) {
      return selectedProvider.models.map(m => ({
        value: m.id,
        label: m.name || m.id,
      }))
    }
    return providers.flatMap(p => p.models.map(m => ({
      value: m.id,
      label: m.name || m.id,
      group: p.name || p.id,
    })))
  }, [providers, selectedProviderId])

  const handleSubmit = (values: AgentFormValues) => {
    const agent: Agent = {
      prompt: values.prompt,
      description: values.description || undefined,
      mode: values.mode,
      temperature: values.temperature,
      topP: values.topP,
      disable: values.disable,
      tools: {
        write: values.write,
        edit: values.edit,
        bash: values.bash,
        webfetch: values.webfetch
      },
      permission: {
        edit: values.editPermission,
        bash: values.bashPermission,
        webfetch: values.webfetchPermission
      }
    }

    if (values.modelId && values.providerId) {
      agent.model = `${values.providerId}/${values.modelId}`
    }

    onSubmit(values.name, agent)
    form.reset()
    onOpenChange(false)
  }

  const handleOpenChange = (isOpen: boolean) => {
    if (!isOpen) {
      form.reset()
    }
    onOpenChange(isOpen)
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent mobileFullscreen keyboardAware className="sm:max-w-2xl sm:max-h-[85vh] gap-0 flex flex-col p-0 md:p-6 pb-safe">
        <DialogHeader className="p-4 sm:p-6 border-b flex flex-row items-center justify-between space-y-0">
          <DialogTitle>{editingAgent ? t('settingsPanels.agentDialog.editTitle') : t('settingsPanels.agentDialog.createTitle')}</DialogTitle>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto p-2 sm:p-4">
          <Form {...form}>
            <div className="space-y-4">
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('settingsPanels.agentDialog.name')}</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        placeholder={t('settingsPanels.agentDialog.namePlaceholder')}
                        disabled={!!editingAgent}
                        className={editingAgent ? 'bg-muted' : ''}
                      />
                    </FormControl>
                    <FormDescription>
                      {t('settingsPanels.agentDialog.nameHint')}
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="description"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('settingsPanels.agentDialog.description')}</FormLabel>
                    <FormControl>
                      <Textarea
                        {...field}
                        placeholder={t('settingsPanels.agentDialog.descriptionPlaceholder')}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="prompt"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('settingsPanels.agentDialog.prompt')}</FormLabel>
                    <FormControl>
                      <Textarea
                        {...field}
                        placeholder={t('settingsPanels.agentDialog.promptPlaceholder')}
                        rows={6}
                        className="font-mono md:text-sm"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                <FormField
                  control={form.control}
                  name="mode"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t('settingsPanels.agentDialog.mode')}</FormLabel>
                      <Select onValueChange={field.onChange} defaultValue={field.value}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder={t('settingsPanels.agentDialog.selectMode')} />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="subagent">{t('settingsPanels.agentDialog.subagent')}</SelectItem>
                          <SelectItem value="primary">{t('settingsPanels.agentDialog.primary')}</SelectItem>
                          <SelectItem value="all">{t('settingsPanels.agentDialog.all')}</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="temperature"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t('settingsPanels.agentDialog.temperature')}</FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          type="number"
                          min="0"
                          max="2"
                          step="0.1"
                          onChange={(e) => field.onChange(parseFloat(e.target.value))}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="topP"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t('settingsPanels.agentDialog.topP')}</FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          type="number"
                          min="0"
                          max="1"
                          step="0.1"
                          onChange={(e) => field.onChange(parseFloat(e.target.value))}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <div className="space-y-2">
                <div className="text-sm font-medium">{t('settingsPanels.agentDialog.modelConfig')}</div>
                <div className="flex flex-col sm:grid grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="providerId"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t('settingsPanels.agentDialog.providerId')}</FormLabel>
                        <FormControl>
                          <Combobox
                            value={field.value || ''}
                            onChange={field.onChange}
                            options={providerOptions}
                            placeholder={t('settingsPanels.agentDialog.providerPlaceholder')}
                            allowCustomValue
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="modelId"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t('settingsPanels.agentDialog.modelId')}</FormLabel>
                        <FormControl>
                          <Combobox
                            value={field.value || ''}
                            onChange={field.onChange}
                            options={modelOptions}
                            placeholder={t('settingsPanels.agentDialog.modelPlaceholder')}
                            allowCustomValue
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <div className="text-sm font-medium">{t('settingsPanels.agentDialog.toolsConfig')}</div>
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <FormField
                    control={form.control}
                    name="write"
                    render={({ field }) => (
                      <FormItem className="flex flex-row items-center space-x-2 space-y-0">
                        <FormControl>
                          <Switch
                            checked={field.value}
                            onCheckedChange={field.onChange}
                          />
                        </FormControl>
                        <FormLabel className="font-normal">{t('settingsPanels.agentDialog.write')}</FormLabel>
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="edit"
                    render={({ field }) => (
                      <FormItem className="flex flex-row items-center space-x-2 space-y-0">
                        <FormControl>
                          <Switch
                            checked={field.value}
                            onCheckedChange={field.onChange}
                          />
                        </FormControl>
                        <FormLabel className="font-normal">{t('settingsPanels.agentDialog.edit')}</FormLabel>
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="bash"
                    render={({ field }) => (
                      <FormItem className="flex flex-row items-center space-x-2 space-y-0">
                        <FormControl>
                          <Switch
                            checked={field.value}
                            onCheckedChange={field.onChange}
                          />
                        </FormControl>
                        <FormLabel className="font-normal">{t('settingsPanels.agentDialog.bash')}</FormLabel>
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="webfetch"
                    render={({ field }) => (
                      <FormItem className="flex flex-row items-center space-x-2 space-y-0">
                        <FormControl>
                          <Switch
                            checked={field.value}
                            onCheckedChange={field.onChange}
                          />
                        </FormControl>
                        <FormLabel className="font-normal">{t('settingsPanels.agentDialog.webFetch')}</FormLabel>
                      </FormItem>
                    )}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <div className="text-sm font-medium">{t('settingsPanels.agentDialog.permissions')}</div>
                <div className="grid grid-cols-3 gap-2 text-sm">
                  <FormField
                    control={form.control}
                    name="editPermission"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-xs">{t('settingsPanels.agentDialog.edit')}</FormLabel>
                        <Select onValueChange={field.onChange} defaultValue={field.value}>
                          <FormControl>
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            <SelectItem value="ask">{t('settingsPanels.agentDialog.ask')}</SelectItem>
                            <SelectItem value="allow">{t('settingsPanels.agentDialog.allow')}</SelectItem>
                            <SelectItem value="deny">{t('settingsPanels.agentDialog.deny')}</SelectItem>
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="bashPermission"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-xs">{t('settingsPanels.agentDialog.bash')}</FormLabel>
                        <Select onValueChange={field.onChange} defaultValue={field.value}>
                          <FormControl>
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            <SelectItem value="ask">{t('settingsPanels.agentDialog.ask')}</SelectItem>
                            <SelectItem value="allow">{t('settingsPanels.agentDialog.allow')}</SelectItem>
                            <SelectItem value="deny">{t('settingsPanels.agentDialog.deny')}</SelectItem>
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="webfetchPermission"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-xs">{t('settingsPanels.agentDialog.webFetch')}</FormLabel>
                        <Select onValueChange={field.onChange} defaultValue={field.value}>
                          <FormControl>
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            <SelectItem value="ask">{t('settingsPanels.agentDialog.ask')}</SelectItem>
                            <SelectItem value="allow">{t('settingsPanels.agentDialog.allow')}</SelectItem>
                            <SelectItem value="deny">{t('settingsPanels.agentDialog.deny')}</SelectItem>
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
              </div>

              <FormField
                control={form.control}
                name="disable"
                render={({ field }) => (
                  <FormItem className="flex flex-row items-center justify-between rounded-lg border p-4">
                    <div className="space-y-0.5">
                      <FormLabel className="text-base">{t('settingsPanels.agentDialog.disableAgent')}</FormLabel>
                      <FormDescription>
                        {t('settingsPanels.agentDialog.disableAgentDescription')}
                      </FormDescription>
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
            </div>
          </Form>
        </div>

        <DialogFooter className="p-3 sm:p-4 border-t gap-2 pb-4">
          <Button variant="outline" onClick={() => handleOpenChange(false)} className="h-11 flex-1 sm:h-9 sm:flex-none">
            {t('settingsPanels.agentDialog.cancel')}
          </Button>
          <Button
            onClick={() => form.handleSubmit(handleSubmit)()}
            disabled={!form.formState.isValid}
            className="h-11 flex-1 sm:h-9 sm:flex-none"
          >
            {editingAgent ? t('settingsPanels.agentDialog.update') : t('settingsPanels.agentDialog.create')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
