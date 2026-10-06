import { useEffect, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { settingsApi } from '@/api/settings'
import { useOpenCodeConfigFile, OPEN_CODE_CONFIG_QUERY_KEY } from '@/hooks/useOpenCodeConfigFile'
import { invalidateConfigCaches } from '@/lib/queryInvalidation'
import { showErrorToast } from '@/lib/error-toast'
import { showToast } from '@/lib/toast'
import { useI18n } from '@/lib/i18n'
import {
  PERMISSION_DECISIONS,
  PERMISSION_TOOLS,
  UNSET,
  applyPatch,
  asString,
  asStringList,
  isPermissionDecision,
  parseLineList,
  readCompaction,
  readPermission,
  sectionPatch,
  stringOrUnset,
  withCompaction,
  withPermissionDecisions,
  type CompactionSettings,
  type OpenCodeConfigContent,
  type Choice,
  type PermissionDecisions,
} from './core-config'
import type { OpenCodeConfigFile } from '@/api/types/settings'

type TriState = typeof UNSET | 'on' | 'off'

function triState(value: boolean | undefined): TriState {
  return value === undefined ? UNSET : value ? 'on' : 'off'
}

function textDiffers(text: string, original: unknown): boolean {
  return asString(original).trim() !== text.trim()
}

function listDiffers(text: string, original: unknown): boolean {
  return parseLineList(text).join('\n') !== asStringList(original).join('\n')
}

/**
 * The top-level knobs the settings dialog had no editor for at all.
 *
 * Everything else in the document - agents, commands, skills, MCP, providers -
 * has its own editor elsewhere; this covers the keys that could previously
 * only be changed by hand-editing JSONC.
 *
 * One card per group, each with its own save. The groups deliberately do not
 * share a form: saving the default model should not discard a half-typed
 * permission change two cards down.
 */
export function OpenCodeCoreSettings() {
  const { t } = useI18n()
  const queryClient = useQueryClient()
  const { data: config } = useOpenCodeConfigFile(true)
  const content = config?.content

  const [model, setModel] = useState(() => asString(content?.model))
  const [smallModel, setSmallModel] = useState(() => asString(content?.small_model))
  const [defaultAgent, setDefaultAgent] = useState(() => asString(content?.default_agent))
  const [enabledProviders, setEnabledProviders] = useState(() => asStringList(content?.enabled_providers).join('\n'))
  const [disabledProviders, setDisabledProviders] = useState(() => asStringList(content?.disabled_providers).join('\n'))
  const [instructions, setInstructions] = useState(() => asStringList(content?.instructions).join('\n'))
  const [permission, setPermission] = useState<Partial<Record<string, Choice>>>(() =>
    readPermission(content?.permission),
  )
  const [compactionAuto, setCompactionAuto] = useState<TriState>(() =>
    triState(readCompaction(content?.compaction).auto),
  )
  const [compactionPrune, setCompactionPrune] = useState<TriState>(() =>
    triState(readCompaction(content?.compaction).prune),
  )

  // Each group follows the document on its own. Sharing one effect would mean
  // that saving the default model silently rewrote the permission selects back
  // to what was on disk, throwing away edits made since.
  useEffect(() => setModel(asString(content?.model)), [content])
  useEffect(() => setSmallModel(asString(content?.small_model)), [content])
  useEffect(() => setDefaultAgent(asString(content?.default_agent)), [content])
  useEffect(() => setEnabledProviders(asStringList(content?.enabled_providers).join('\n')), [content])
  useEffect(() => setDisabledProviders(asStringList(content?.disabled_providers).join('\n')), [content])
  useEffect(() => setInstructions(asStringList(content?.instructions).join('\n')), [content])
  useEffect(() => setPermission(readPermission(content?.permission)), [content])
  useEffect(() => setCompactionAuto(triState(readCompaction(content?.compaction).auto)), [content])
  useEffect(() => setCompactionPrune(triState(readCompaction(content?.compaction).prune)), [content])

  const saveMutation = useMutation({
    mutationFn: async (patch: Record<string, unknown>) => {
      // Read the freshest revision out of the cache rather than closing over
      // the one this render saw: two cards saved in a row must not send the
      // second one a revision the server has already retired.
      const current = queryClient.getQueryData<OpenCodeConfigFile>(OPEN_CODE_CONFIG_QUERY_KEY)
      if (!current) {
        throw new Error('opencode-config-not-loaded')
      }
      return settingsApi.updateOpenCodeConfig({
        content: applyPatch(current.content, patch) as OpenCodeConfigContent,
        expectedRevision: current.revision,
      })
    },
    onSuccess: () => {
      invalidateConfigCaches(queryClient)
      showToast.success(t('settingsPanels.coreConfig.saved'))
    },
    onError: (error) => showErrorToast(error, t('settingsPanels.coreConfig.saveFailed')),
  })

  const pending = saveMutation.isPending

  const decisionsFrom = (choices: Partial<Record<string, Choice>>): PermissionDecisions => {
    const decisions: PermissionDecisions = {}
    for (const tool of PERMISSION_TOOLS) {
      const choice = choices[tool]
      if (choice && choice !== UNSET && isPermissionDecision(choice)) {
        decisions[tool] = choice
      }
    }
    return decisions
  }

  const permissionDirty = PERMISSION_TOOLS.some((tool) => {
    const stored = readPermission(content?.permission)[tool] ?? UNSET
    return (permission[tool] ?? UNSET) !== stored
  })

  const compactionDirty = (() => {
    const stored = readCompaction(content?.compaction)
    return compactionAuto !== triState(stored.auto) || compactionPrune !== triState(stored.prune)
  })()

  const savePermission = () => {
    const merged = withPermissionDecisions(content?.permission, decisionsFrom(permission))
    saveMutation.mutate(sectionPatch('permission', merged))
  }

  const saveCompaction = () => {
    const next: CompactionSettings = {}
    if (compactionAuto === 'on') next.auto = true
    if (compactionAuto === 'off') next.auto = false
    if (compactionPrune === 'on') next.prune = true
    if (compactionPrune === 'off') next.prune = false
    saveMutation.mutate(sectionPatch('compaction', withCompaction(content?.compaction, next)))
  }

  const decisionLabel = (decision: string) => {
    if (decision === 'allow') return t('settingsPanels.coreConfig.permissionAllow')
    if (decision === 'ask') return t('settingsPanels.coreConfig.permissionAsk')
    if (decision === 'deny') return t('settingsPanels.coreConfig.permissionDeny')
    return t('settingsPanels.coreConfig.unset')
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('settingsPanels.coreConfig.modelsTitle')}</CardTitle>
          <CardDescription>{t('settingsPanels.coreConfig.modelsDescription')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="core-model">{t('settingsPanels.coreConfig.modelLabel')}</Label>
            <Input
              id="core-model"
              value={model}
              onChange={(event) => setModel(event.target.value)}
              placeholder="anthropic/claude-sonnet-4-5"
              autoComplete="off"
              className="font-mono text-sm"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="core-small-model">{t('settingsPanels.coreConfig.smallModelLabel')}</Label>
            <Input
              id="core-small-model"
              value={smallModel}
              onChange={(event) => setSmallModel(event.target.value)}
              placeholder="anthropic/claude-haiku-4-5"
              autoComplete="off"
              className="font-mono text-sm"
            />
          </div>
          <Button
            onClick={() =>
              saveMutation.mutate({
                model: stringOrUnset(model),
                small_model: stringOrUnset(smallModel),
              })
            }
            disabled={pending || (!textDiffers(model, content?.model) && !textDiffers(smallModel, content?.small_model))}
          >
            {t('settingsPanels.coreConfig.saveModels')}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('settingsPanels.coreConfig.agentTitle')}</CardTitle>
          <CardDescription>{t('settingsPanels.coreConfig.agentDescription')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="core-default-agent">{t('settingsPanels.coreConfig.defaultAgentLabel')}</Label>
            <Input
              id="core-default-agent"
              value={defaultAgent}
              onChange={(event) => setDefaultAgent(event.target.value)}
              placeholder="build"
              autoComplete="off"
              className="font-mono text-sm"
            />
          </div>
          <Button
            onClick={() => saveMutation.mutate({ default_agent: stringOrUnset(defaultAgent) })}
            disabled={pending || !textDiffers(defaultAgent, content?.default_agent)}
          >
            {t('settingsPanels.coreConfig.saveAgent')}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('settingsPanels.coreConfig.providersTitle')}</CardTitle>
          <CardDescription>{t('settingsPanels.coreConfig.providersDescription')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="core-enabled-providers">{t('settingsPanels.coreConfig.enabledProvidersLabel')}</Label>
            <Textarea
              id="core-enabled-providers"
              value={enabledProviders}
              onChange={(event) => setEnabledProviders(event.target.value)}
              rows={3}
              className="font-mono text-sm"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="core-disabled-providers">{t('settingsPanels.coreConfig.disabledProvidersLabel')}</Label>
            <Textarea
              id="core-disabled-providers"
              value={disabledProviders}
              onChange={(event) => setDisabledProviders(event.target.value)}
              rows={3}
              className="font-mono text-sm"
            />
          </div>
          <Button
            onClick={() =>
              saveMutation.mutate({
                enabled_providers:
                  parseLineList(enabledProviders).length > 0
                    ? parseLineList(enabledProviders)
                    : undefined,
                disabled_providers:
                  parseLineList(disabledProviders).length > 0
                    ? parseLineList(disabledProviders)
                    : undefined,
              })
            }
            disabled={
              pending ||
              (!listDiffers(enabledProviders, content?.enabled_providers) &&
                !listDiffers(disabledProviders, content?.disabled_providers))
            }
          >
            {t('settingsPanels.coreConfig.saveProviders')}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('settingsPanels.coreConfig.permissionTitle')}</CardTitle>
          <CardDescription>{t('settingsPanels.coreConfig.permissionDescription')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            {PERMISSION_TOOLS.map((tool) => (
              <div key={tool} className="flex items-center justify-between gap-3">
                <Label htmlFor={`core-permission-${tool}`} className="font-mono text-xs">
                  {tool}
                </Label>
                <Select
                  value={permission[tool] ?? UNSET}
                  onValueChange={(value) =>
                    setPermission((previous) => ({ ...previous, [tool]: value as Choice }))
                  }
                >
                  <SelectTrigger id={`core-permission-${tool}`} className="w-40 shrink-0">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={UNSET}>{t('settingsPanels.coreConfig.unset')}</SelectItem>
                    {PERMISSION_DECISIONS.map((decision) => (
                      <SelectItem key={decision} value={decision}>
                        {decisionLabel(decision)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ))}
          </div>
          <Button onClick={savePermission} disabled={pending || !permissionDirty}>
            {t('settingsPanels.coreConfig.savePermission')}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('settingsPanels.coreConfig.compactionTitle')}</CardTitle>
          <CardDescription>{t('settingsPanels.coreConfig.compactionDescription')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            {(
              [
                ['auto', t('settingsPanels.coreConfig.compactionAutoLabel'), compactionAuto, setCompactionAuto],
                ['prune', t('settingsPanels.coreConfig.compactionPruneLabel'), compactionPrune, setCompactionPrune],
              ] as const
            ).map(([key, label, value, setValue]) => (
              <div key={key} className="flex items-center justify-between gap-3">
                <Label htmlFor={`core-compaction-${key}`}>{label}</Label>
                <Select
                  value={value}
                  onValueChange={(next) => setValue(next as TriState)}
                >
                  <SelectTrigger id={`core-compaction-${key}`} className="w-40 shrink-0">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={UNSET}>{t('settingsPanels.coreConfig.unset')}</SelectItem>
                    <SelectItem value="on">{t('settingsPanels.coreConfig.on')}</SelectItem>
                    <SelectItem value="off">{t('settingsPanels.coreConfig.off')}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            ))}
          </div>
          <Button onClick={saveCompaction} disabled={pending || !compactionDirty}>
            {t('settingsPanels.coreConfig.saveCompaction')}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('settingsPanels.coreConfig.instructionsTitle')}</CardTitle>
          <CardDescription>{t('settingsPanels.coreConfig.instructionsDescription')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Textarea
            id="core-instructions"
            value={instructions}
            onChange={(event) => setInstructions(event.target.value)}
            rows={4}
            className="font-mono text-sm"
          />
          <Button
            onClick={() =>
              saveMutation.mutate({
                instructions: parseLineList(instructions).length > 0 ? parseLineList(instructions) : undefined,
              })
            }
            disabled={pending || !listDiffers(instructions, content?.instructions)}
          >
            {t('settingsPanels.coreConfig.saveInstructions')}
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}