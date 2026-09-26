import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { RepoList } from "@/components/repo/RepoList";
import { AddRepoDialog } from "@/components/repo/AddRepoDialog";
import { FileBrowserSheet } from "@/components/file-browser/FileBrowserSheet";
import { WorkspaceDashboard } from "@/components/dashboard/WorkspaceDashboard";
import { Header } from "@/components/ui/header";
import { PendingActionsGroup } from "@/components/notifications/PendingActionsGroup";
import { useSidebarAction } from "@/hooks/useSidebarAction";
import { useDialogParam } from "@/hooks/useDialogParam";
import { useI18n } from '@/lib/i18n'

export function Repos() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const [addRepoOpen, setAddRepoOpen] = useState(false);
  const [fileBrowserOpen, setFileBrowserOpen] = useDialogParam('files');

  const handleCloseFileBrowser = () => {
    setFileBrowserOpen(false);
  };

  useSidebarAction('new-repo', () => {
    setAddRepoOpen(true);
  });

  return (
    <div className="h-dvh max-h-dvh overflow-hidden bg-background flex flex-col">
      <Header>
        <div className="flex items-center gap-3">
          <Header.Title>{t('home.appName')}</Header.Title>
        </div>
        <Header.Actions>
          <div className="flex items-center gap-1">
            <PendingActionsGroup />
          </div>
          <span>
            <Header.Settings />
          </span>
        </Header.Actions>
      </Header>
      <div className="container mx-auto flex-1 px-3 sm:px-4 pt-4 min-h-0 overflow-auto pb-[calc(env(safe-area-inset-bottom)+60px)] sm:pb-4">
        <WorkspaceDashboard
          onNewRepo={() => setAddRepoOpen(true)}
          onOpenFiles={() => setFileBrowserOpen(true)}
          onOpenSchedules={() => navigate('/schedules')}
        />

        <RepoList />
      </div>
      <AddRepoDialog open={addRepoOpen} onOpenChange={setAddRepoOpen} />
      <FileBrowserSheet
        isOpen={fileBrowserOpen}
        onClose={handleCloseFileBrowser}
        basePath=""
        repoName={t('repo.workspaceRoot')}
        allowNavigateAboveBase={true}
      />
    </div>
  );
}
