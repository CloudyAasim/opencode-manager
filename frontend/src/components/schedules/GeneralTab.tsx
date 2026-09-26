import { Combobox, type ComboboxOption } from '@/components/ui/combobox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { TabsContent } from '@/components/ui/tabs'
import { Info } from 'lucide-react'
import { useI18n } from '@/lib/i18n'

type GeneralTabProps = {
  name: string
  onNameChange: (value: string) => void
  description: string
  onDescriptionChange: (value: string) => void
  agentSlug: string
  onAgentSlugChange: (value: string) => void
  agentOptions: ComboboxOption[]
  model: string
  onModelChange: (value: string) => void
  modelOptions: ComboboxOption[]
  enabled: boolean
  onEnabledChange: (value: boolean) => void
  branch: string
  onBranchChange: (value: string) => void
  branchOptions: ComboboxOption[]
  branchesLoading: boolean
  showRepoSelector?: boolean
  isEditing: boolean
  repoId?: number
  onRepoChange?: (repoId: number | undefined) => void
  repoOptions: ComboboxOption[]
  allowExternalDirectory: boolean
  onAllowExternalDirectoryChange: (value: boolean) => void
  allowQuestions: boolean
  onAllowQuestionsChange: (value: boolean) => void
  bashDenyPatterns: string[]
  onBashDenyPatternsChange: (value: string[]) => void
}

function InfoHint({ text }: { text: string }) {
  return (
    <span
      title={text}
      aria-label={text}
      className="inline-flex h-4 w-4 items-center justify-center text-muted-foreground"
    >
      <Info className="h-3.5 w-3.5" />
    </span>
  )
}

export function GeneralTab({
  name,
  onNameChange,
  description,
  onDescriptionChange,
  agentSlug,
  onAgentSlugChange,
  agentOptions,
  model,
  onModelChange,
  modelOptions,
  enabled,
  onEnabledChange,
  branch,
  onBranchChange,
  branchOptions,
  branchesLoading,
  showRepoSelector,
  isEditing,
  repoId,
  onRepoChange,
  repoOptions,
  allowExternalDirectory,
  onAllowExternalDirectoryChange,
  allowQuestions,
  onAllowQuestionsChange,
  bashDenyPatterns,
  onBashDenyPatternsChange,
}: GeneralTabProps) {
  const { t } = useI18n()

  return (
    <TabsContent value="basics" className="mt-0 min-h-0 flex-1 overflow-y-auto pt-4 pb-5">
      <div className="space-y-4">
        {showRepoSelector && !isEditing && (
          <div className="space-y-2">
            <Label>{t('schedules.general.repository')}</Label>
            <Combobox
              value={repoId?.toString() ?? ''}
              onChange={(value) => onRepoChange?.(value ? Number(value) : undefined)}
              options={repoOptions}
              placeholder={t('schedules.general.selectRepository')}
              allowCustomValue={false}
            />
          </div>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="schedule-name">{t('schedules.common.name')}</Label>
            <Input
              id="schedule-name"
              value={name}
              onChange={(event) => onNameChange(event.target.value)}
              placeholder={t('schedules.general.namePlaceholder')}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="schedule-description">{t('schedules.common.description')}</Label>
            <Input
              id="schedule-description"
              value={description}
              onChange={(event) => onDescriptionChange(event.target.value)}
              placeholder={t('schedules.general.descriptionPlaceholder')}
            />
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_220px] sm:items-end">
          <div className="space-y-2">
            <Label htmlFor="schedule-agent">{t('schedules.general.agentSlug')}</Label>
            <Combobox
              value={agentSlug}
              onChange={onAgentSlugChange}
              options={agentOptions}
              placeholder={t('schedules.general.selectAgent')}
              allowCustomValue
              showClear
            />
          </div>

          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Label htmlFor="schedule-model">{t('schedules.general.modelOverride')}</Label>
              <InfoHint text={t('schedules.general.modelOverrideHint')} />
            </div>
            <Combobox
              value={model}
              onChange={onModelChange}
              options={modelOptions}
              placeholder={t('schedules.common.workspaceDefault')}
              allowCustomValue
              showClear
            />
          </div>
        </div>

        <div className="rounded-lg border border-border bg-card p-4">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <p className="text-sm font-medium">{t('schedules.common.enabled')}</p>
              <InfoHint text={t('schedules.general.enabledHint')} />
            </div>
            <Switch checked={enabled} onCheckedChange={onEnabledChange} />
          </div>
        </div>

        <div className="rounded-lg border border-border bg-card p-4">
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Label htmlFor="schedule-branch">{t('schedules.common.baseBranch')}</Label>
              <InfoHint text={t('schedules.general.baseBranchHint')} />
            </div>
            <Combobox
              value={branch}
              onChange={onBranchChange}
              options={branchOptions}
              placeholder={branchesLoading ? t('schedules.general.loadingBranches') : t('schedules.general.defaultsToDefaultBranch')}
              disabled={branchesLoading}
              allowCustomValue={false}
              showClear
            />
          </div>
        </div>

        <div className="space-y-2">
          <h3 className="text-sm font-medium text-muted-foreground">{t('schedules.general.permissions')}</h3>
          <div className="rounded-lg border border-border bg-card p-4">
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-2">
                <p className="text-sm font-medium">{t('schedules.general.allowExternalDirectory')}</p>
                <InfoHint text={t('schedules.general.allowExternalDirectoryHint')} />
              </div>
              <Switch checked={allowExternalDirectory} onCheckedChange={onAllowExternalDirectoryChange} />
            </div>
          </div>
          <div className="rounded-lg border border-border bg-card p-4">
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-2">
                <p className="text-sm font-medium">{t('schedules.general.allowQuestions')}</p>
                <InfoHint text={t('schedules.general.allowQuestionsHint')} />
              </div>
              <Switch checked={allowQuestions} onCheckedChange={onAllowQuestionsChange} />
            </div>
          </div>
          <div className="rounded-lg border border-border bg-card p-4">
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Label htmlFor="schedule-bash-deny">{t('schedules.general.blockedBashCommands')}</Label>
                <InfoHint text={t('schedules.general.blockedBashCommandsHint')} />
              </div>
              <Textarea
                id="schedule-bash-deny"
                value={bashDenyPatterns.join('\n')}
                onChange={(event) => {
                  const patterns = event.target.value.split('\n')
                  onBashDenyPatternsChange(patterns)
                }}
                placeholder="rm -rf *"
                className="font-mono text-xs min-h-[100px]"
              />
            </div>
          </div>
        </div>
      </div>
    </TabsContent>
  )
}
