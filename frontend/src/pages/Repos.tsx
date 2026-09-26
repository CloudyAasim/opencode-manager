import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { RepoList } from "@/components/repo/RepoList";
import { AddRepoDialog } from "@/components/repo/AddRepoDialog";
import { FileBrowserSheet } from "@/components/file-browser/FileBrowserSheet";
import { Header } from "@/components/ui/header";
import { Button } from "@/components/ui/button";
import { Plus, FolderOpen, CalendarClock } from "lucide-react";
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
          <Header.Title logo>OpenCode</Header.Title>
        </div>
        <Header.Actions>
          <div className="flex items-center gap-1">
            <PendingActionsGroup />
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setFileBrowserOpen(true)}
            aria-label={t('repo.openFiles')}
            className="hidden sm:flex text-muted-foreground hover:text-foreground hover:bg-accent transition-all duration-200 h-8 w-8"
          >
            <FolderOpen className="w-4 h-4" />
          </Button>
          <Button
            variant="outline"
            onClick={() => navigate('/schedules')}
            size="sm"
            className="hidden sm:flex text-foreground border-border hover:bg-accent transition-all duration-200 hover:scale-105"
          >
            <CalendarClock className="w-4 h-4 mr-2" />
            {t('repo.allSchedules')}
          </Button>
          <Button onClick={() => setAddRepoOpen(true)} size="sm">
            <Plus className="w-4 h-4 mr-1" />
            {t('repo.addRepo')}
          </Button>
          <span>
            <Header.Settings />
          </span>
        </Header.Actions>
      </Header>
      <div className="container mx-auto flex-1 px-3 sm:px-4 pt-4 min-h-0 overflow-auto pb-[calc(env(safe-area-inset-bottom)+60px)] sm:pb-4">
        <section className="mb-5 rounded-xl border border-border bg-card p-5 shadow-xs">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <h1 className="text-lg font-semibold text-foreground">{t('home.title')}</h1>
              <p className="mt-1 text-sm text-muted-foreground">{t('home.subtitle')}</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="outline" size="sm" onClick={() => setFileBrowserOpen(true)}>
                <FolderOpen className="w-4 h-4" />
                {t('home.files')}
              </Button>
              <Button variant="outline" size="sm" onClick={() => navigate('/schedules')}>
                <CalendarClock className="w-4 h-4" />
                {t('home.schedules')}
              </Button>
              <Button size="sm" onClick={() => setAddRepoOpen(true)}>
                <Plus className="w-4 h-4" />
                {t('home.newRepo')}
              </Button>
            </div>
          </div>
        </section>

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
