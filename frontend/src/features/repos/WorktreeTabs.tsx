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
  onCreateWorkspace: () => void
  onWorkspaceMenu?: () => void
}

/**
 * The bar at the foot of a session: which branch, which workspace.
 *
 * The right end used to be empty, and the way to make a workspace lived in the
 * tab strip - as a trailing plus inside the "Workspace" button - so it was
 * there only when there was no workspace yet. One had to go to the manager
 * first to make the second one.
 *
 * Now the right end holds the key, always. There is one way to make a
 * workspace, and it is in the same place whether there are none or many.
 */
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
    <div className="px-4 pt-2 flex-shrink-0 flex items-center gap-2">
      <Tabs value={value} onValueChange={(next) => onValueChange(next as WorktreeTabValue)} className="min-w-0 flex-1">
        <TabsList className="w-full justify-start gap-1 overflow-hidden">
          <TabsTrigger value="repo" className={tabClassName}>
            <GitBranch className="size-3 shrink-0" />
            <span className={`min-w-0 truncate ${activeLabelClassName}`}>{baseLabel}</span>
          </TabsTrigger>
          {hasWorkspaces ? (
            <TabsTrigger value="workspaces" className={tabClassName} onClick={onWorkspaceMenu}>
              <Layers className="size-3 shrink-0 text-primary" />
              <span className={`min-w-0 truncate ${activeLabelClassName}`}>{workspaceLabel}</span>
              <span className={`shrink-0 text-xs text-muted-foreground ${activeLabelClassName}`}>({workspaces.length})</span>
            </TabsTrigger>
          ) : null}
        </TabsList>
      </Tabs>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={onCreateWorkspace}
        className="shrink-0 gap-1 text-muted-foreground"
        title={t('repo.newWorkspace')}
        aria-label={t('repo.newWorkspace')}
      >
        <Plus className="size-3.5 shrink-0" />
        <span className="truncate">{t('repo.newWorkspace')}</span>
      </Button>
    </div>
  )
}
