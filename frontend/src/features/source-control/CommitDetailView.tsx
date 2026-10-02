import { useCommitDetails } from '@/api/git'
import { PanelLoading } from '@/components/ui/panel-loading'
import { PanelMessage } from '@/components/ui/panel-message'
import { GitCommit, ArrowLeft } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { GitFlatFileList } from './GitFlatFileList'
import { FileDiffView } from '@/features/source-control/FileDiffView'
import { useI18n } from '@/lib/i18n'

interface CommitDetailViewProps {
  repoId: number
  commitHash: string
  onBack: () => void
  onFileSelect: (path: string) => void
  selectedFile?: string
}

export function CommitDetailView({ repoId, commitHash, onBack, onFileSelect, selectedFile }: CommitDetailViewProps) {
  const { t } = useI18n()
  const { data: commit, isLoading, error } = useCommitDetails(repoId, commitHash)

  if (isLoading) {
    return (
      <PanelLoading className="h-full py-12" size="md" />
    )
  }

  if (error || !commit) {
    return (
      <PanelMessage
        icon={<GitCommit />}
        title={t('misc.commitDetail.loadFailed')}
        detail={error?.message}
        action={
          <Button variant="outline" size="sm" onClick={onBack} className="mt-4">
            <ArrowLeft className="w-4 h-4 mr-2" />
            {t('misc.commitDetail.backToCommits')}
          </Button>
        }
      />
    )
  }

  const commitFiles = commit.files.map(f => ({
    path: f.path,
    status: f.status,
    staged: false,
    oldPath: f.oldPath,
    additions: f.additions,
    deletions: f.deletions
  }))

  const totalAdditions = commit.files.reduce((sum, f) => sum + (f.additions || 0), 0)
  const totalDeletions = commit.files.reduce((sum, f) => sum + (f.deletions || 0), 0)

  if (selectedFile) {
    return (
      <div className="flex flex-col h-full min-h-0 overflow-hidden">
        <FileDiffView
          repoId={repoId}
          filePath={selectedFile}
          includeStaged={false}
          commitHash={commitHash}
          onBack={() => onFileSelect('')}
        />
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      <div className="px-3 py-3 border-b border-border flex-shrink-0 space-y-2">
        <div className="flex items-start gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={onBack}
            className="h-7 w-7 p-0 flex-shrink-0 mt-0.5"
          >
            <ArrowLeft className="w-4 h-4" />
          </Button>
          <p className="text-sm font-medium leading-snug">{commit.message}</p>
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground pl-9">
          <span className="font-mono">{commit.hash.substring(0, 7)}</span>
          <span>·</span>
          <span className="truncate">{commit.authorName}</span>
          <span>·</span>
          <span className="flex-shrink-0">{new Date(parseInt(commit.date, 10) * 1000).toLocaleDateString()}</span>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-1 pt-1">
        <GitFlatFileList
          files={commitFiles}
          staged={false}
          onSelect={(path) => onFileSelect(path)}
          selectedFile={selectedFile}
          readOnly={true}
          totalAdditions={totalAdditions}
          totalDeletions={totalDeletions}
        />
      </div>
    </div>
  )
}
