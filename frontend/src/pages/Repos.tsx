import { useNavigate } from "react-router-dom";
import { Bot } from "lucide-react";
import { RepoList } from "@/features/repos/RepoList";
import { AddRepoDialog } from "@/features/repos/AddRepoDialog";
import { FileBrowserSheet } from "@/features/file-browser/FileBrowserSheet";
import { Header } from "@/components/ui/header";
import { Button } from "@/components/ui/button";
import { PendingActionsGroup } from "@/features/notifications/PendingActionsGroup";
import { useSidebarAction } from "@/hooks/useSidebarAction";
import { Plus } from "lucide-react";
import { useI18n } from '@/lib/i18n'
import { useLayer } from '@/framework/layer/useLayer'

export function Repos() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const [addRepoOpen, setAddRepoOpen] = useLayer('addRepo');
  const [fileBrowserOpen, setFileBrowserOpen] = useLayer('files');

  useSidebarAction('new-repo', () => {
    setAddRepoOpen(true);
  });

  return (
    <div className="h-dvh max-h-dvh overflow-hidden bg-background flex flex-col">
      <Header>
        <Header.Title>{t('navigation.repos')}</Header.Title>
        <Header.Actions>
          <div className="flex items-center gap-1">
            <PendingActionsGroup />
          </div>
          <Button
            onClick={() => setAddRepoOpen(true)}
            size="sm"
            className="h-9 bg-primary hover:bg-primary-hover text-primary-foreground"
          >
            <Plus className="w-4 h-4 sm:mr-1" />
            <span className="hidden sm:inline">{t('navigation.newRepo')}</span>
          </Button>
          <span>
            <Header.Settings />
          </span>
        </Header.Actions>
      </Header>
      <div className="container mx-auto flex-1 px-3 sm:px-4 pt-4 min-h-0 overflow-auto pb-[calc(env(safe-area-inset-bottom)+60px)] sm:pb-4">
        <button
          type="button"
          onClick={() => navigate('/assistant')}
          className="relative mb-3 w-full cursor-pointer overflow-hidden rounded-xl border border-border bg-card text-left transition-all duration-200 active:scale-[0.98] hover:border-blue-500/50 hover:bg-accent/50 hover:shadow-md"
        >
          <div className="p-1.5">
            <div className="mb-1 flex items-start gap-2">
              <div className="flex min-w-0 flex-1 items-center gap-2">
                <h3 className="truncate text-base font-semibold text-foreground">{t('navigation.assistant')}</h3>
                <span className="h-2 w-2 shrink-0 rounded-full bg-green-500" />
              </div>
              <Bot className="h-4 w-4 shrink-0 text-muted-foreground" />
            </div>
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <span className="flex min-w-0 flex-1 items-center gap-1.5">
                <Bot className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">{t('repo.assistantHint')}</span>
              </span>
            </div>
          </div>
        </button>
        <RepoList />
      </div>
      <AddRepoDialog open={addRepoOpen} onOpenChange={setAddRepoOpen} />
      <FileBrowserSheet
        isOpen={fileBrowserOpen}
        onClose={() => setFileBrowserOpen(false)}
        basePath=""
        repoName={t('repo.workspaceRoot')}
        allowNavigateAboveBase={true}
      />
    </div>
  );
}
