import { RepoList } from "@/features/repos/RepoList";
import { AddRepoDialog } from "@/features/repos/AddRepoDialog";
import { FileBrowserSheet } from "@/features/file-browser/FileBrowserSheet";
import { Header } from "@/components/ui/header";
import { Button } from "@/components/ui/button";
import { PendingActionsGroup } from "@/features/notifications/PendingActionsGroup";
import { Plus } from "lucide-react";
import { useI18n } from '@/lib/i18n'
import { useLayer } from '@/framework/layer/useLayer'

export function Repos() {
  const { t } = useI18n();
  const [addRepoOpen, setAddRepoOpen] = useLayer('addRepo');
  const [fileBrowserOpen, setFileBrowserOpen] = useLayer('files');

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
        </Header.Actions>
      </Header>
      <div className="container mx-auto flex-1 px-3 sm:px-4 pt-4 min-h-0 overflow-auto pb-[calc(env(safe-area-inset-bottom)+60px)] sm:pb-4">
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
