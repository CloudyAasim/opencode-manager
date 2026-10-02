import { useNavigate } from "react-router-dom"
import { useEffect } from "react"
import { useQuery } from "@tanstack/react-query"
import { getRepo, initializeAssistantMode } from "@/api/repos"
import { useCreateSession } from "@/hooks/useOpenCode"
import { useSidebarAction } from "@/hooks/useSidebarAction"
import { useSSE } from "@/hooks/useSSE"
import { OPENCODE_API_ENDPOINT } from "@/config"
import { Button } from "@/components/ui/button"
import { Header } from "@/components/ui/header"
import { SessionList } from "@/features/session/SessionList"
import { FileBrowserSheet } from "@/features/file-browser/FileBrowserSheet"
import { RepoMcpDialog } from "@/features/repos/RepoMcpDialog"
import { RepoSkillsDialog } from "@/features/repos/RepoSkillsDialog"
import { SourceControlPanel } from "@/features/source-control"
import { ResetPermissionsDialog } from "@/features/repos/ResetPermissionsDialog"
import { PendingActionsGroup } from "@/features/notifications/PendingActionsGroup"
import { useI18n } from "@/lib/i18n"
import { DEFAULT_REPO_BRANCH } from '@/lib/repo-constants'
import { Plus } from "lucide-react"
import { useLayer } from '@/framework/layer/useLayer'

export function AssistantRedirect() {
  const navigate = useNavigate()
  const { t } = useI18n()
  const repoId = 0
  const [fileBrowserOpen, setFileBrowserOpen] = useLayer('files')
  const [mcpDialogOpen, setMcpDialogOpen] = useLayer('mcp')
  const [skillsDialogOpen, setSkillsDialogOpen] = useLayer('skills')
  const [sourceControlOpen, setSourceControlOpen] = useLayer('sourceControl')
  const [resetPermissionsOpen, setResetPermissionsOpen] = useLayer('resetPermissions')

  const opcodeUrl = OPENCODE_API_ENDPOINT
  const { data: repo, isLoading: repoLoading, error: repoError } = useQuery({
    queryKey: ["repo", repoId],
    queryFn: () => getRepo(repoId),
  })

  const assistantDirectory = repo?.fullPath

  useEffect(() => {
    if (!assistantDirectory) return
    void initializeAssistantMode(repoId).catch(() => undefined)
  }, [assistantDirectory, repoId])

  useSSE(opcodeUrl, assistantDirectory)

  const createSessionMutation = useCreateSession(opcodeUrl, assistantDirectory, (session) => {
    navigate(`/repos/${repoId}/sessions/${session.id}?assistant=1`)
  })

  const handleCreateSession = async () => {
    await createSessionMutation.mutateAsync({ agent: undefined })
  }

  useSidebarAction('new-session', () => {
    handleCreateSession()
  })

  return (
    <div className="h-dvh max-h-dvh overflow-hidden bg-background flex flex-col pb-[calc(env(safe-area-inset-bottom)+56px)] sm:pb-0">
      <Header>
        <Header.BackButton to="/" />
        <Header.Title>{t('misc.assistant.title')}</Header.Title>
        <Header.Actions>
          <div className="flex items-center gap-1">
            <PendingActionsGroup />
          </div>
          <Button onClick={() => handleCreateSession()} disabled={!opcodeUrl || !assistantDirectory || createSessionMutation.isPending} size="sm" className="hidden sm:inline-flex bg-primary hover:bg-primary-hover text-primary-foreground transition-all duration-200 hover:scale-105">
            <Plus className="w-4 h-4 mr-2" />
            <span>{t('misc.assistant.newSession')}</span>
          </Button>
          <Button onClick={() => handleCreateSession()} disabled={!opcodeUrl || !assistantDirectory || createSessionMutation.isPending} aria-label={t('misc.assistant.newSession')} size="sm" className="sm:hidden h-10 w-10 p-0 bg-primary hover:bg-primary-hover text-primary-foreground transition-all duration-200 hover:scale-105">
            <Plus className="w-5 h-5" />
          </Button>
        </Header.Actions>
      </Header>
      <div className="flex-1 flex flex-col min-h-0">
        {repoError ? (
          <div className="p-4 text-sm text-muted-foreground">{t('misc.assistant.loadFailed')}</div>
        ) : repoLoading || !repo?.fullPath ? (
          <div className="p-4 text-sm text-muted-foreground">{t('misc.assistant.loading')}</div>
        ) : (
          <SessionList
            opcodeUrl={opcodeUrl}
            directory={assistantDirectory}
            onSelectSession={(sessionId) => navigate(`/repos/${repoId}/sessions/${sessionId}?assistant=1`)}
          />
        )}
      </div>
      {assistantDirectory && (
        <>
          <FileBrowserSheet isOpen={fileBrowserOpen} onClose={() => setFileBrowserOpen(false)} basePath={repo?.localPath} repoName={t('misc.assistant.repoName')} repoId={repoId} />
          <RepoMcpDialog open={mcpDialogOpen} onOpenChange={setMcpDialogOpen} directory={assistantDirectory} />
          {assistantDirectory && opcodeUrl ? (
            <RepoSkillsDialog
              open={skillsDialogOpen}
              onOpenChange={setSkillsDialogOpen}
              repoId={repoId}
              sessionId="assistant-session"
              opcodeUrl={opcodeUrl}
              directory={assistantDirectory}
            />
          ) : (
            <RepoSkillsDialog
              open={skillsDialogOpen}
              onOpenChange={setSkillsDialogOpen}
              repoId={repoId}
            />
          )}
          <SourceControlPanel repoId={repoId} isOpen={sourceControlOpen} onClose={() => setSourceControlOpen(false)} currentBranch={repo?.currentBranch || repo?.branch || DEFAULT_REPO_BRANCH} repoName={t('misc.assistant.repoName')} />
          <ResetPermissionsDialog open={resetPermissionsOpen} onOpenChange={setResetPermissionsOpen} repoId={repoId} />
        </>
      )}
    </div>
  )
}
