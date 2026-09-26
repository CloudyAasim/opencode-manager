import { useState } from "react";
import { RepoList } from "@/components/repo/RepoList";
import { AddRepoDialog } from "@/components/repo/AddRepoDialog";
import { FileBrowserSheet } from "@/components/file-browser/FileBrowserSheet";
import { Header } from "@/components/ui/header";
import { Button } from "@/components/ui/button";
import { PendingActionsGroup } from "@/components/notifications/PendingActionsGroup";
import { useSidebarAction } from "@/hooks/useSidebarAction";
import { useDialogParam } from "@/hooks/useDialogParam";
import { Plus } from "lucide-react";
import { useI18n } from '@/lib/i18n'

export function Repos() {
  const { t } = useI18n();
  const [addRepoOpen, setAddRepoOpen] = useState(false);
  const [fileBrowserOpen, setFileBrowserOpen] = useDialogParam('files');

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
