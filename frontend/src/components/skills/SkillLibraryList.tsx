import { useMemo, useState } from 'react'
import { Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { SettingsList, SettingsListRow } from '@/components/ui/settings-list'
import { useI18n } from '@/lib/i18n'
import type { SkillFileInfo, SkillScope } from '@opencode-manager/shared'

type SkillFilter = 'all' | SkillScope

interface SkillLibraryAction {
  label: string
  onClick: (skill: SkillFileInfo) => void
  destructive?: boolean
}

interface SkillLibraryListProps {
  isLoading: boolean
  data: SkillFileInfo[] | undefined
  error: Error | null
  primaryAction?: {
    label: string
    onClick: (skill: SkillFileInfo) => void
  }
  rowActions?: SkillLibraryAction[]
  emptyTitle?: string
  emptyHint?: string
  maxHeightClassName?: string
}

const getSkillKey = (skill: SkillFileInfo) => `${skill.scope}-${skill.repoId ?? 'global'}-${skill.name}`

/**
 * A module-level constant rather than a fresh `[]` per render: it is the
 * dependency of both memos below, and a new array each render would make every
 * memo miss on every render for no reason.
 */
const EMPTY: readonly SkillFileInfo[] = []

const matchesSkillSearch = (skill: SkillFileInfo, search: string) => {
  const query = search.trim().toLowerCase()
  if (!query) return true
  return [skill.name, skill.description, skill.location, skill.repoName]
    .filter(Boolean)
    .some((value) => value?.toLowerCase().includes(query))
}

export function SkillLibraryList({
  isLoading,
  data,
  error,
  primaryAction,
  rowActions = [],
  emptyTitle,
  emptyHint,
  maxHeightClassName = 'max-h-[420px]',
}: SkillLibraryListProps) {
  const { t } = useI18n()
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<SkillFilter>('all')

  const getScopeLabel = (skill: SkillFileInfo) => {
    if (skill.scope === 'global') return t('misc.skills.global')
    return skill.repoName ? t('misc.skills.projectWithName', { name: skill.repoName }) : t('misc.skills.project')
  }

  const getCompactScopeLabel = (skill: SkillFileInfo) =>
    skill.scope === 'global' ? t('misc.skills.global') : t('misc.skills.project')

  const filterLabelKeys: Record<SkillFilter, string> = {
    all: 'misc.skills.filterAll',
    project: 'misc.skills.filterProject',
    global: 'misc.skills.filterGlobal',
  }

  // `data ?? []` looks like a guard and is not one. `??` only catches null and
  // undefined; an object, a string or a number from the server sails straight
  // through, and this component's first array call is a `.filter`, so it threw
  // `n.filter is not a function` and the error boundary ate the page. This is
  // the first `.filter` to run when the skills list opens, which is why the
  // crash always presented as the Skills screen.
  //
  // `listManagedSkills` now rejects a non-array before it gets this far. This
  // is the second line of defence, and it is here because the cost of being
  // wrong is a dead page rather than a wrong count.
  const skills = Array.isArray(data) ? data : EMPTY

  const counts = useMemo(() => {
    return {
      all: skills.length,
      project: skills.filter((skill) => skill.scope === 'project').length,
      global: skills.filter((skill) => skill.scope === 'global').length,
    }
  }, [skills])

  const filteredSkills = useMemo(() => {
    return skills
      .filter((skill) => filter === 'all' || skill.scope === filter)
      .filter((skill) => matchesSkillSearch(skill, search))
  }, [skills, filter, search])

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={t('misc.skills.searchPlaceholder')}
            className="pl-9"
          />
        </div>
        <div className="flex items-center gap-1 rounded-lg border border-border bg-muted/30 p-1">
          {(['all', 'project', 'global'] as const).map((key) => (
            <Button key={key} type="button" variant={filter === key ? 'secondary' : 'ghost'} size="sm" onClick={() => setFilter(key)}>
              <span>{t(filterLabelKeys[key])}</span>
              <span>{counts[key]}</span>
            </Button>
          ))}
        </div>
      </div>

      <SettingsList
        isLoading={isLoading}
        error={error}
        isEmpty={filteredSkills.length === 0}
        emptyTitle={emptyTitle ?? t('misc.skills.noSkills')}
        emptyHint={emptyHint ?? t('misc.skills.emptyHint')}
        errorTitle={t('misc.skills.errorTitle')}
        maxHeightClassName={maxHeightClassName}
      >
        {filteredSkills.map((skill) => (
          <SettingsListRow
            key={getSkillKey(skill)}
            title={skill.name}
            titleClassName="text-primary"
            description={skill.description}
            onClick={primaryAction ? () => primaryAction.onClick(skill) : undefined}
            primaryAction={primaryAction ? { label: primaryAction.label, onClick: () => primaryAction.onClick(skill) } : undefined}
            actions={rowActions.map((a) => ({ label: a.label, destructive: a.destructive, onClick: () => a.onClick(skill) }))}
            actionsLabel={t('misc.skills.actionsFor', { name: skill.name })}
            badges={
              <>
                <Badge variant={skill.scope === 'global' ? 'secondary' : 'outline'} className="shrink-0 sm:hidden">
                  {getCompactScopeLabel(skill)}
                </Badge>
                <Badge variant={skill.scope === 'global' ? 'secondary' : 'outline'} className="hidden max-w-full truncate sm:inline-flex">
                  {getScopeLabel(skill)}
                </Badge>
              </>
            }
          />
        ))}
      </SettingsList>
    </div>
  )
}
