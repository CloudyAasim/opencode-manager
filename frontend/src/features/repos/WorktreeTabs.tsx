import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { GitBranch, Layers, Plus } from 'lucide-react'
import type { RepoSibling } from '@/api/repos'
import type { WorktreeTabValue } from '@/hooks/useWorktreeTab'
import { useI18n } from '@/lib/i18n'
import { Button } from '@/components/ui/button'

interface WorktreeTabsProps {
  workspaces: RepoSibling[]
  value: WorktreeTabValue
  onValueChange: (value: WorktreeTabValue) => void
  baseLabel: string
  activeWorkspaceLabel?: string
  onCreateWorkspace?: () => void
  onWorkspaceMenu?: () => void
}

export function WorktreeTabs({
  workspaces,
  value,
  onValueChange,
  baseLabel,
  activeWorkspaceLabel,
  onCreateWorkspace,
  onWorkspaceMenu,
}: WorktreeTabsProps) {
  const { t } = useI18n()
  const hasWorkspaces = workspaces.length > 0
  const workspaceLabel = value === 'workspaces' && activeWorkspaceLabel ? activeWorkspaceLabel : t('repo.workspaces')
  const tabClassName =
    'group min-w-0 flex-1 gap-1.5 px-2 sm:flex-none sm:px-3 data-[state=active]:border data-[state=active]:border-primary/50 data-[state=active]:bg-primary/10 data-[state=inactive]:hover:bg-accent data-[state=inactive]:hover:text-foreground'
  const activeLabelClassName = 'group-data-[state=active]:text-primary dark:group-data-[state=active]:text-primary'

  return (
    <div className="px-4 pt-2 flex-shrink-0">
      <Tabs value={value} onValueChange={(next) => onValueChange(next as WorktreeTabValue)} className="min-w-0">
        <TabsList className="w-full justify-start gap-1 overflow-hidden">
          <TabsTrigger value="repo" className={tabClassName}>
            <GitBranch className="size-3 shrink-0" />
            <span className={`min-w-0 truncate ${activeLabelClassName}`}>{baseLabel}</span>
          </TabsTrigger>
          {hasWorkspaces ? (
            <>
              <TabsTrigger value="workspaces" className={tabClassName} onClick={onWorkspaceMenu}>
                <Layers className="size-3 shrink-0 text-primary" />
                <span className={`min-w-0 truncate ${activeLabelClassName}`}>{workspaceLabel}</span>
                <span className={`shrink-0 text-xs text-muted-foreground ${activeLabelClassName}`}>({workspaces.length})</span>
              </TabsTrigger>
            </>
          ) : (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={onCreateWorkspace}
              className="min-w-0 flex-1 justify-center text-muted-foreground hover:text-foreground sm:flex-none"
            >
              <Layers className="size-3 shrink-0 text-primary" />
              <span className="min-w-0 truncate">{t('repo.workspace')}</span>
              <Plus className="size-3.5 shrink-0" />
            </Button>
          )}
        </TabsList>
      </Tabs>
    </div>
  )
}
