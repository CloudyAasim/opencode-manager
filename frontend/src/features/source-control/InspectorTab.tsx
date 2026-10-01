import { GitBranch } from 'lucide-react'
import { useLocation } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { listRepos } from '@/api/repos'
import { useI18n } from '@/lib/i18n'
import { SourceControlContent } from '@/features/source-control/SourceControlContent'
import { useRegisterInspectorTab } from '@/framework/inspector/registry'
import type { InspectorTabDefinition } from '@/framework/inspector/registry'

function repoIdFromPath(pathname: string): number | null {
  const match = /^\/repos\/(\d+)/.exec(pathname)
  return match?.[1] ? Number(match[1]) : null
}

function SourceControlPanelBody() {
  const { t } = useI18n()
  const { pathname } = useLocation()
  const { data: repos } = useQuery({ queryKey: ['repos'], queryFn: listRepos })
  const repoId = repoIdFromPath(pathname)
  const repo = repos?.find((entry) => entry.id === repoId)

  if (!repoId || !repo) {
    return <p className="p-4 text-sm text-muted-foreground">{t('shell.inspector.needProject')}</p>
  }
  return (
    <SourceControlContent
      repoId={repoId}
      currentBranch={repo.currentBranch || repo.branch || ''}
      isMobile={false}
    />
  )
}

const TAB: InspectorTabDefinition = {
  id: 'source-control',
  labelKey: 'misc.sourceControl.title',
  icon: GitBranch,
  render: () => <SourceControlPanelBody />,
}

export function SourceControlInspectorTab() {
  useRegisterInspectorTab(TAB)
  return null
}
