import { useState } from "react";
import { useParams, useNavigate, useLocation } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { getRepo } from "@/api/repos";
import { MessageThread } from "@/features/message/MessageThread";
import { PromptInput, type PromptInputHandle } from "@/features/message/PromptInput";
import { FloatingTTSButton } from '@/features/message/FloatingTTSButton'
import { X, CornerUpLeft, PanelLeft, PanelRight, Plus, Folder, GitPullRequest, CalendarClock, Plug, Sparkles, Info, TerminalSquare, FileText, Command as CommandIcon } from "lucide-react";
import { Header } from "@/components/ui/header";
import { SessionList } from "@/features/session/SessionList";
import { getSessionListPath } from '@/lib/navigation'
import { FetchError } from '@/api/fetchWrapper'

import { FileTreeExplorer } from "@/features/file-browser/FileTreeExplorer";
import { FilePreview } from "@/features/file-browser/FilePreview";
import { FileDiffView } from "@/features/source-control/FileDiffView";
import { resolvePreviewFile } from "@/features/file-browser/resolve-preview-file";
import { ProjectInfoPanel } from "@/features/repos/ProjectInfoPanel";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { TerminalView } from "@/features/terminal/TerminalView";
import type { FileInfo } from "@/types/files";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ContextUsageIndicator } from "@/features/session/ContextUsageIndicator";
import { useSession, useAbortSession, useUpdateSession, useMessages, useCreateSession } from "@/hooks/useOpenCode";
import { useRepoActivity } from "@/hooks/useRepoActivity";
import { useRepoSiblings, useCreateRepoWorkspace, useDeleteRepoWorkspaces } from "@/hooks/useRepoSiblings";
import { useWorktreeTab } from "@/hooks/useWorktreeTab";
import { SessionRouteFallback } from "@/features/session/SessionRouteFallback";
import { WorktreeTabs } from "@/features/repos/WorktreeTabs";
import { WorkspaceManager } from "@/features/repos/WorkspaceManager";
import { CreateWorkspaceDialog } from "@/features/repos/CreateWorkspaceDialog";
import { workspaceLabel } from "@/api/repos";
import { OPENCODE_API_ENDPOINT } from "@/config";
import { useSSE } from "@/hooks/useSSE";
import { useUIState } from "@/stores/uiStateStore";
import { useSettings } from "@/hooks/useSettings";
import { useModelSelection } from "@/hooks/useModelSelection";
import { useKeyboardShortcuts } from "@/hooks/useKeyboardShortcuts";
import { useAutoScroll } from "@/hooks/useAutoScroll";
import { useMobile } from "@/hooks/useMobile";
import { useVisualViewport } from "@/hooks/useVisualViewport";
import { useTTS } from "@/hooks/useTTS";
import { getAssistantText, getLatestPlayableAssistantMessage, useAutoPlayLastResponse } from "@/hooks/useAutoPlayLastResponse";
import { useEffect, useRef, useCallback, useMemo } from "react";
import { MessageSkeleton } from "@/features/message/MessageSkeleton";
import { exportSession, downloadMarkdown } from "@/lib/exportSession";
import type { MessageWithParts } from "@/api/types";
import { getMessagesContentVersion } from "./sessionContentVersion";
import { showToast } from "@/lib/toast";
import { getRepoDisplayName } from "@/lib/utils";
import { cn } from "@/lib/utils";
import { RepoOverlays } from "@/features/repos/RepoOverlays";
import { createOpenCodeClient } from "@/api/opencode";
import { usePermissions, useQuestions } from "@/contexts/EventContext";
import { useSessionStatusForSession } from "@/stores/sessionStatusStore";
import type { QuestionRequest } from "@/api/types";
import { QuestionPrompt } from "@/features/session/QuestionPrompt";
import { MinimizedQuestionIndicator } from "@/features/session/MinimizedQuestionIndicator";
import { PendingActionsGroup } from "@/features/notifications/PendingActionsGroup";
import { SessionPanel, type SessionPanelTab } from "@/features/session/SessionPanel";
import { SessionRail } from "@/features/session/SessionRail";
import { ChangesTab } from "@/features/source-control";
import { SessionSendErrorBanner } from "@/features/session/SessionSendErrorBanner";
import { SessionTodoDisplay } from "@/features/message/SessionTodoDisplay";
import { MEDIA } from '@/framework/shell/breakpoints';
import { percentOfContainer, pixelDeltaInverted, useDragResize } from '@/framework/shell/useDragResize';
import { useDesktop } from "@/hooks/useDesktop";
import { SessionMoreButton } from "@/features/navigation/SessionMoreButton";
import { useI18n } from "@/lib/i18n";
import { projectSessionPath } from "@/lib/project-session-path";
import { usePersistentNumberState } from "@/hooks/usePersistentNumberState";
import { useCommands } from "@/hooks/useCommands";
import { toPromptMentionPath } from "@/lib/prompt-mention-path";
import type { components } from "@/api/opencode-types";

type CommandType = components['schemas']['Command'];
import { STORAGE_KEYS } from "@/lib/storage-keys";
import { useLayer } from '@/framework/layer/useLayer'
import {
  CHAT_PANEL_WIDTH_MIN,
  CHAT_PANEL_WIDTH_MAX,
  CHAT_PANEL_WIDTH_DEFAULT,
  FILE_TREE_WIDTH_MIN,
  FILE_TREE_WIDTH_MAX,
  FILE_TREE_WIDTH_DEFAULT,
  DEFAULT_REPO_BRANCH,
} from "@/lib/repo-constants";

const compareMessageIds = (id1: string, id2: string): number => {
  const num1 = parseInt(id1, 10)
  const num2 = parseInt(id2, 10)
  if (!isNaN(num1) && !isNaN(num2)) return num1 - num2
  return id1.localeCompare(id2)
}

export const DEFAULT_PANEL_TAB_IDS = ['files', 'terminal', 'review', 'info'] as const

const PENDING_ACTION_SYNC_INTERVAL_MS = 30000
const PROMPT_OVERLAY_CLEARANCE_PX = 16

export function SessionDetail() {
  const { t } = useI18n();
  const { id, sessionId } = useParams<{ id: string; sessionId: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const repoId = Number(id) || 0;
  // The assistant is a project (repo 0) reached without an :id in the path,
  // so this covers both /assistant and /repos/0/assistant.
  const isAssistantSession =
    id === undefined || new URLSearchParams(location.search).get('assistant') === '1';
  const { preferences, updateSettings } = useSettings();
  const openSettings = useCallback(() => navigate('/settings'), [navigate]);
  const isDesktop = useDesktop();
  const messageContainerRef = useRef<HTMLDivElement>(null);
  const promptInputRef = useRef<PromptInputHandle>(null);
  const [sessionsDialogOpen, setSessionsDialogOpen] = useLayer('sessions');
  const [fileBrowserOpen, setFileBrowserOpen] = useLayer('files');
  const [, setMcpDialogOpen] = useLayer('mcp');
  const [, setSkillsDialogOpen] = useLayer('skills');
  const [, setSourceControlOpen] = useLayer('sourceControl');
  const [rightPanelOpen, setRightPanelOpen] = useState(false)
  const [railOpen, setRailOpen] = useState(() =>
    typeof window === 'undefined' || typeof window.matchMedia !== 'function'
      ? true
      : window.matchMedia(MEDIA.layoutUp).matches,
  )
  const [panelWidth, setPanelWidth] = usePersistentNumberState({
    storageKey: STORAGE_KEYS.chatPanelWidth,
    defaultValue: CHAT_PANEL_WIDTH_DEFAULT,
    min: CHAT_PANEL_WIDTH_MIN,
    max: CHAT_PANEL_WIDTH_MAX,
  })
  const [reviewFile, setReviewFile] = useState<{ path: string; staged: boolean } | null>(null)

  const handleSelectPanelFile = useCallback(async (file: FileInfo) => {
    setPanelFile(file)
    const resolved = await resolvePreviewFile(file)
    if (!file.isDirectory) setPanelFile(resolved)
  }, [])
  const [panelFile, setPanelFile] = useState<FileInfo | null>(null)
  const [treeWidth, setTreeWidth] = usePersistentNumberState({
    storageKey: STORAGE_KEYS.fileTreeWidth,
    defaultValue: FILE_TREE_WIDTH_DEFAULT,
    min: FILE_TREE_WIDTH_MIN,
    max: FILE_TREE_WIDTH_MAX,
  })
  const filesPanelRef = useRef<HTMLDivElement>(null)

  const sessionPanelTabs: SessionPanelTab[] = [
    {
      id: 'files',
      labelKey: 'navigation.files',
      icon: Folder,
      render: () => (
      <div ref={filesPanelRef} className="flex h-full min-h-0">
        <div className="min-h-0 overflow-hidden" style={{ width: `${treeWidth}%` }}>
          <FileTreeExplorer
            rootPath={repoDirectory ?? ''}
            selectedPath={panelFile?.path}
            onSelectFile={handleSelectPanelFile}
            className="h-full"
          />
        </div>
        <div
          role="separator"
          aria-orientation="vertical"
          onMouseDown={startTreeResize.onMouseDown}
          onTouchStart={startTreeResize.onTouchStart}
          className="w-1 shrink-0 cursor-col-resize bg-border/40 transition-colors hover:bg-primary/40"
        />
        <div className="min-h-0 flex-1 overflow-y-auto">
          {panelFile && !panelFile.isDirectory ? (
            <FilePreview key={panelFile.path} file={panelFile} />
          ) : (
            <div className="flex h-full items-center justify-center p-4 text-center text-sm text-muted-foreground">
              {t('repo.fileBrowser.selectFileToPreview')}
            </div>
          )}
        </div>
      </div>
      ),
    },
    {
      id: 'review',
      labelKey: 'navigation.sourceControl',
      icon: GitPullRequest,
      render: () => (
      <div className="h-full overflow-y-auto">
        {reviewFile ? (
          <FileDiffView
            repoId={repoId}
            filePath={reviewFile.path}
            includeStaged={reviewFile.staged}
            onBack={() => setReviewFile(null)}
            isMobile={false}
          />
        ) : (
          <ChangesTab
            repoId={repoId}
            onFileSelect={(path, staged) => setReviewFile({ path, staged })}
            isMobile={false}
          />
        )}
      </div>
      ),
    },
    {
      id: 'info',
      labelKey: 'navigation.detail',
      icon: Info,
      render: () => (
      <ProjectInfoPanel
        repoId={repoId}
        name={workspaceDisplayName}
        directory={repoDirectory}
        branch={repo?.currentBranch || repo?.branch}
      />
      ),
    },
    {
      id: 'terminal',
      labelKey: 'navigation.terminal',
      icon: TerminalSquare,
      render: () => (
      <div className="h-full min-h-0">
        <TerminalView className="h-full" cwd={repoDirectory} />
      </div>
      ),
    },
  ]

  const startTreeResize = useDragResize({
    containerRef: filesPanelRef,
    getValue: () => treeWidth,
    setValue: setTreeWidth,
    toValue: percentOfContainer,
  })

  const startPanelResize = useDragResize({
    getValue: () => panelWidth,
    setValue: setPanelWidth,
    toValue: pixelDeltaInverted,
  })

  const handlePanelResizeKey = useCallback((event: React.KeyboardEvent) => {
    if (event.key === 'ArrowLeft') {
      event.preventDefault()
      setPanelWidth(panelWidth + 16)
    } else if (event.key === 'ArrowRight') {
      event.preventDefault()
      setPanelWidth(panelWidth - 16)
    }
  }, [panelWidth, setPanelWidth])
  const [selectedFilePath, setSelectedFilePath] = useState<string | undefined>();
  const [showScrollButton, setShowScrollButton] = useState(false);
  const [hasPromptContent, setHasPromptContent] = useState(false);
  // The command and mention-file entries used to live in the mobile "more"
  // drawer, where they shared a list with Settings. They are conversation
  // input, so they sit on the conversation screen now, next to the composer
  // they feed.
  const [commandsPanelOpen, setCommandsPanelOpen] = useState(false);
  const [commandQuery, setCommandQuery] = useState('');
  const [minimizedQuestion, setMinimizedQuestion] = useState<QuestionRequest | null>(null);

  const isMobile = useMobile();
  const { keyboardHeight } = useVisualViewport();
  const inputBottomOffset = isMobile ? keyboardHeight : 0;
  const promptOverlayObserverRef = useRef<ResizeObserver | null>(null);
  const [promptOverlayHeight, setPromptOverlayHeight] = useState(112);

  const promptOverlayRef = useCallback((el: HTMLDivElement | null) => {
    promptOverlayObserverRef.current?.disconnect();
    promptOverlayObserverRef.current = null;
    if (!el) {
      setPromptOverlayHeight(0);
      return;
    }
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) {
        setPromptOverlayHeight(entry.contentRect.height);
      }
    });
    observer.observe(el);
    promptOverlayObserverRef.current = observer;
  }, []);

  const { data: repo, isLoading: repoLoading } = useQuery({
    queryKey: ["repo", repoId],
    queryFn: () => getRepo(repoId),
    enabled: id !== undefined,
    retry: (failureCount, error) => !(error instanceof FetchError && error.statusCode === 404) && failureCount < 3,
  });

  useRepoActivity(repoId, Boolean(repo));

  const { activeTab, setActiveTab } = useWorktreeTab();
  const { data: siblings } = useRepoSiblings(repoId);
  const createWorkspace = useCreateRepoWorkspace(repoId);
  const deleteWorkspaces = useDeleteRepoWorkspaces(repoId);
  const [createWorkspaceOpen, setCreateWorkspaceOpen] = useLayer('createWorkspace');
  const [workspaceSelectorOpen, setWorkspaceSelectorOpen] = useLayer('workspaceSelector');
  const [activeWorkspaceDirectory, setActiveWorkspaceDirectory] = useState<string | undefined>();

  const workspaceSiblings = useMemo(
    () => (siblings ?? []).filter((sibling) => !!sibling.workspaceId && !!sibling.fullPath),
    [siblings],
  );

  const workspaceDirectories = useMemo(
    () => workspaceSiblings.map((sibling) => sibling.fullPath).filter(Boolean),
    [workspaceSiblings],
  );

  const directoryLabels = useMemo(() => {
    const labels: Record<string, string> = {};
    workspaceSiblings.forEach((sibling) => {
      if (sibling.fullPath) {
        labels[sibling.fullPath] = workspaceLabel(sibling);
      }
    });
    return labels;
  }, [workspaceSiblings]);

  useEffect(() => {
    if (workspaceDirectories.length === 0) {
      setActiveWorkspaceDirectory(undefined);
      return;
    }
    setActiveWorkspaceDirectory((current) => (
      current && workspaceDirectories.includes(current) ? current : workspaceDirectories[0]
    ));
  }, [workspaceDirectories]);

  const handleCreateWorkspace = useCallback(async () => {
    const workspace = await createWorkspace.mutateAsync();
    if (workspace.directory) {
      setActiveWorkspaceDirectory(workspace.directory);
    }
    setActiveTab('workspaces');
    setCreateWorkspaceOpen(false);
  }, [createWorkspace, setActiveTab, setCreateWorkspaceOpen]);

  const handleOpenWorkspaceSelector = useCallback(() => {
    if (workspaceSiblings.length === 0) {
      setCreateWorkspaceOpen(true);
      return;
    }
    setActiveTab('workspaces');
    setWorkspaceSelectorOpen(true);
  }, [workspaceSiblings.length, setActiveTab, setCreateWorkspaceOpen, setWorkspaceSelectorOpen]);

  const currentBranch = repo?.currentBranch || repo?.branch || DEFAULT_REPO_BRANCH;

  const opcodeUrl = OPENCODE_API_ENDPOINT;
  
  const sessionRouteSuffix = isAssistantSession ? '?assistant=1' : '';

  const repoDirectory = repo?.fullPath;
  const [resolvedSessionDirectory, setResolvedSessionDirectory] = useState<{ sessionId: string; directory: string } | null>(null);
  const sessionDirectory = (
    resolvedSessionDirectory && resolvedSessionDirectory.sessionId === sessionId
      ? resolvedSessionDirectory.directory
      : undefined
  ) ?? repoDirectory;

  const { data: session, isLoading: sessionLoading, error: sessionQueryError } = useSession(
    opcodeUrl,
    sessionId,
    sessionDirectory,
  );

  useEffect(() => {
    const directory = session?.directory;
    if (!sessionId || !directory) return;
    setResolvedSessionDirectory((current) => (
      current?.sessionId === sessionId && current.directory === directory
        ? current
        : { sessionId, directory }
    ));
  }, [sessionId, session?.directory]);

  const { isConnected, isReconnecting } = useSSE(opcodeUrl, sessionDirectory, sessionId);

  const { data: rawMessages, isLoading: messagesLoading } = useMessages(opcodeUrl, sessionId, sessionDirectory, { fallbackPoll: !isConnected });

  const messages = useMemo(() => {
    if (!rawMessages) return undefined
    const revertMessageID = session?.revert?.messageID
    if (!revertMessageID) return rawMessages
    return rawMessages.filter(msgWithParts => compareMessageIds(msgWithParts.info.id, revertMessageID) < 0)
  }, [rawMessages, session?.revert?.messageID]);

  const getMessagesWithParts = useCallback((): MessageWithParts[] | undefined => {
    return messages
  }, [messages])

  const messagesContentVersion = useMemo(() => getMessagesContentVersion(messages), [messages]);

  const { scrollToBottom } = useAutoScroll({
    containerRef: messageContainerRef,
    messages: messages?.map(m => m.info),
    sessionId,
    contentVersion: messagesContentVersion,
    onScrollStateChange: setShowScrollButton
  });
  const abortSession = useAbortSession(opcodeUrl, sessionDirectory, sessionId);
  const updateSession = useUpdateSession(opcodeUrl, sessionDirectory);
  const createSession = useCreateSession(opcodeUrl, sessionDirectory);
  // Reached only when the project has no session yet. Nothing is created until
  // the first message: a create response with no id throws rather than becoming
  // a path and a POST to it.
  const ensureSessionForNewConversation = useCallback(async () => {
    const created = await createSession.mutateAsync({ agent: undefined })
    if (!created?.id) throw new Error('The session could not be created')
    navigate(
      projectSessionPath(repoId, created.id, activeTab) +
        (isAssistantSession ? '?assistant=1' : ''),
      { replace: true },
    )
    return created.id
  }, [createSession, navigate, repoId, activeTab, isAssistantSession]);
  const { model, modelString } = useModelSelection(opcodeUrl, sessionDirectory);
  const isEditingMessage = useUIState((state) => state.isEditingMessage);
  const setActivePromptFileBasePath = useUIState((state) => state.setActivePromptFileBasePath);
  // The file browser itself is mounted once, by RepoOverlays; the page
  // only opens and closes that one.
  const [, setFilesBrowserOpen] = useLayer('files');
  const selectPromptCommand = useUIState((state) => state.selectPromptCommand);
  const selectPromptFile = useUIState((state) => state.selectPromptFile);
  const activePromptFileBasePath = useUIState((state) => state.activePromptFileBasePath);
  const { filterCommands } = useCommands(opcodeUrl);
  const commandList = filterCommands(commandQuery);

  const closeCommandsPanel = useCallback(() => {
    setCommandsPanelOpen(false);
    setCommandQuery('');
  }, []);

  const handleSelectCommand = useCallback(
    (command: CommandType) => {
      selectPromptCommand(command);
      closeCommandsPanel();
    },
    [selectPromptCommand, closeCommandsPanel],
  );

  const handleSelectMentionFile = useCallback(
    (file: FileInfo) => {
      selectPromptFile(toPromptMentionPath(file.path, activePromptFileBasePath));
      setFilesBrowserOpen(false);
    },
    [selectPromptFile, activePromptFileBasePath, setFilesBrowserOpen],
  );
  const { isEnabled: ttsEnabled } = useTTS();
  const sessionStatus = useSessionStatusForSession(sessionId);
  const { syncForSession: syncPermissionsForSession } = usePermissions();
  const { getForSession: getQuestionForSession, reply: replyToQuestion, reject: rejectQuestion, syncForSession: syncQuestionsForSession } = useQuestions();
  const currentQuestion = sessionId ? getQuestionForSession(sessionId) : null;

  const lastAssistantMessage = messages?.filter(m => m.info.role === 'assistant').at(-1);
  const lastAssistantText = getAssistantText(lastAssistantMessage);
  const latestPlayableAssistant = useMemo(() => getLatestPlayableAssistantMessage(messages), [messages]);
  
  const isSessionActive = useMemo(() => {
    if (session?.time?.compacting) return true
    if (sessionStatus.type !== 'idle') return true
    if (lastAssistantMessage && !('completed' in lastAssistantMessage.info.time)) return true
    return false
  }, [lastAssistantMessage, session?.time?.compacting, sessionStatus.type])
  const hasIncompleteMessages = lastAssistantMessage ? !('completed' in lastAssistantMessage.info.time && lastAssistantMessage.info.time.completed) : false;
  const isStreamingResponse = hasIncompleteMessages && isSessionActive;
  const workspaceBasePath = repo?.localPath;

  useEffect(() => {
    setActivePromptFileBasePath(sessionDirectory ? workspaceBasePath ?? null : null)

    return () => {
      setActivePromptFileBasePath(null)
    }
  }, [sessionDirectory, setActivePromptFileBasePath, workspaceBasePath])

  useAutoPlayLastResponse({
    sessionId: sessionId ?? '',
    lastAssistantMessage,
    lastAssistantText,
    isStreamingResponse,
  });

  const handleShowSessionsDialog = useCallback(() => setSessionsDialogOpen(true), [setSessionsDialogOpen]);
  const handleShowHelpDialog = useCallback(() => openSettings(), [openSettings]);

  const handleMinimizeQuestion = useCallback((question: QuestionRequest) => {
    setMinimizedQuestion(question)
  }, [])
  
  const handleRestoreQuestion = useCallback(() => {
    setMinimizedQuestion(null)
  }, [])

  useEffect(() => {
    if (minimizedQuestion && minimizedQuestion.sessionID !== sessionId) {
      setMinimizedQuestion(null)
    }
  }, [sessionId, minimizedQuestion])

  const syncPendingActionsForSession = useCallback(async () => {
    if (!sessionDirectory || !sessionId) return
    await Promise.all([
      syncPermissionsForSession(sessionDirectory, sessionId),
      syncQuestionsForSession(sessionDirectory, sessionId),
    ])
  }, [sessionDirectory, sessionId, syncPermissionsForSession, syncQuestionsForSession])

  useQuery({
    queryKey: ['opencode', 'pending-actions', opcodeUrl, sessionId, sessionDirectory],
    queryFn: async () => {
      await syncPendingActionsForSession()
      return null
    },
    enabled: !!sessionDirectory && !!sessionId,
    refetchOnMount: 'always',
    refetchOnReconnect: true,
    refetchOnWindowFocus: true,
    refetchInterval: !isConnected && (isSessionActive || hasIncompleteMessages) ? PENDING_ACTION_SYNC_INTERVAL_MS : false,
    retry: false,
  })

  const handleNewSession = useCallback(async () => {
    try {
      const newSession = await createSession.mutateAsync({ agent: undefined });
      if (newSession?.id) {
        navigate(`/repos/${repoId}/sessions/${newSession.id}${sessionRouteSuffix}`);
      }
    } catch {
      showToast.error(t('session.actions.createFailed'));
    }
  }, [createSession, navigate, repoId, sessionRouteSuffix, t]);

  const handleCompact = useCallback(async () => {
    if (!opcodeUrl || !sessionId) return;
    if (!model?.providerID || !model?.modelID) {
      showToast.error(t('session.actions.noModel'));
      return;
    }

    showToast.loading(t('session.actions.compacting'), { id: `compact-${sessionId}` });

    try {
      const client = createOpenCodeClient(opcodeUrl, sessionDirectory);
      await client.summarizeSession(sessionId, model.providerID, model.modelID);
    } catch (error) {
      const message = error instanceof Error ? error.message : t('session.actions.unknownError');
      showToast.error(t('session.actions.compactFailed', { error: message }));
    }
  }, [opcodeUrl, sessionId, model, sessionDirectory, t]);

  const handleUndo = useCallback(async () => {
    if (!opcodeUrl || !sessionId) return;
    try {
      const client = createOpenCodeClient(opcodeUrl, sessionDirectory);
      await client.sendCommand(sessionId, { command: 'undo', arguments: '' });
    } catch (error) {
      const message = error instanceof Error ? error.message : t('session.actions.unknownError');
      showToast.error(t('session.actions.undoFailed', { error: message }));
    }
  }, [opcodeUrl, sessionId, sessionDirectory, t]);

  const handleRedo = useCallback(async () => {
    if (!opcodeUrl || !sessionId) return;
    try {
      const client = createOpenCodeClient(opcodeUrl, sessionDirectory);
      await client.sendCommand(sessionId, { command: 'redo', arguments: '' });
    } catch (error) {
      const message = error instanceof Error ? error.message : t('session.actions.unknownError');
      showToast.error(t('session.actions.redoFailed', { error: message }));
    }
  }, [opcodeUrl, sessionId, sessionDirectory, t]);

  const handleFork = useCallback(async () => {
    if (!opcodeUrl || !sessionId) return;
    try {
      const client = createOpenCodeClient(opcodeUrl, sessionDirectory);
      const forkedSession = await client.forkSession(sessionId);
      if (forkedSession?.id) {
        navigate(`/repos/${repoId}/sessions/${forkedSession.id}${sessionRouteSuffix}`);
        showToast.success(t('session.actions.forked'));
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : t('session.actions.unknownError');
      showToast.error(t('session.actions.forkFailed', { error: message }));
    }
  }, [opcodeUrl, sessionId, sessionDirectory, navigate, repoId, sessionRouteSuffix, t]);

  const handleCloseSession = useCallback(() => {
    navigate(getSessionListPath(isAssistantSession))
  }, [navigate, isAssistantSession])

  const { leaderActive } = useKeyboardShortcuts({
    sessions: () => setSessionsDialogOpen(true),
    settings: openSettings,
    newSession: handleNewSession,
    closeSession: handleCloseSession,
    compact: handleCompact,
    undo: handleUndo,
    redo: handleRedo,
    fork: handleFork,
    toggleFileBrowser: () => setFileBrowserOpen(!fileBrowserOpen),
    abort: () => {
      if (sessionId) {
        abortSession.mutate(sessionId);
      }
    },
  });

  

  const handleFileClick = useCallback((filePath: string) => {
    let pathToOpen = filePath
    
    if (filePath.startsWith('/') && repo?.fullPath) {
      const workspaceReposPath = repo.fullPath.substring(0, repo.fullPath.lastIndexOf('/'))
      
      if (filePath.startsWith(workspaceReposPath + '/')) {
        pathToOpen = filePath.substring(workspaceReposPath.length + 1)
      }
    }
    
    setSelectedFilePath(pathToOpen)
    setFileBrowserOpen(true)
  }, [repo?.fullPath, setFileBrowserOpen]);

  const handleSessionTitleUpdate = useCallback((newTitle: string) => {
    if (sessionId) {
      updateSession.mutate({ sessionID: sessionId, title: newTitle });
    }
  }, [sessionId, updateSession]);

  const handleFileBrowserClose = useCallback(() => {
    setSelectedFilePath(undefined)
  }, []);

  const handleChildSessionClick = useCallback((childSessionId: string) => {
    navigate(`/repos/${repoId}/sessions/${childSessionId}${sessionRouteSuffix}`)
  }, [navigate, repoId, sessionRouteSuffix]);

  const handleParentSessionClick = useCallback(() => {
    if (session?.parentID) {
      navigate(`/repos/${repoId}/sessions/${session.parentID}${sessionRouteSuffix}`)
    }
  }, [navigate, repoId, session?.parentID, sessionRouteSuffix]);

  const handleToggleDetails = useCallback(() => {
    const newValue = !preferences?.expandToolCalls
    updateSettings({ expandToolCalls: newValue })
    return newValue
  }, [preferences?.expandToolCalls, updateSettings]);

  const handleExportSession = useCallback(async () => {
    const data = getMessagesWithParts()
    if (!data || !session) {
      showToast.error(t('session.actions.noDataToExport'))
      return
    }
    
    const { filename, content } = exportSession(data, session)
    if (await downloadMarkdown(content, filename)) {
      showToast.success(t('session.actions.exportedTo', { filename }))
    }
  }, [getMessagesWithParts, session, t]);

  const handleUndoMessage = useCallback((restoredPrompt: string) => {
    promptInputRef.current?.setPromptValue(restoredPrompt)
  }, []);

  const handleClearPrompt = useCallback(() => {
    promptInputRef.current?.clearPrompt()
  }, []);

  

  

  if (!isAssistantSession && repoLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-background">
        <div className="flex flex-col items-center gap-2">
          <div className="w-8 h-8 animate-spin rounded-full border-2 border-muted border-t-foreground" />
          <span className="text-muted-foreground">{t('session.route.loadingRepository')}</span>
        </div>
      </div>
    );
  }

  if (!isAssistantSession && !repo) {
    return <SessionRouteFallback message={t('session.route.repositoryNotFound')} backTo="/" backLabel={t('session.route.backToRepositories')} />;
  }

  // Only a session we asked for can be missing. With no session yet
  // the query is disabled and there is nothing to report.
  if (sessionId && sessionQueryError instanceof FetchError && sessionQueryError.statusCode === 404) {
    return (
      <SessionRouteFallback
        message={t('session.route.sessionNotFound')}
        backTo={getSessionListPath(isAssistantSession)}
        backLabel={t('session.route.backToSessions')}
      />
    );
  }

  const workspaceDisplayName = isAssistantSession || !repo
    ? t('session.header.assistant')
    : getRepoDisplayName(repo);
  const sessionBackPath = getSessionListPath(isAssistantSession);

  return (
    <div
      className="h-dvh max-h-dvh overflow-hidden bg-background flex flex-col pb-[calc(env(safe-area-inset-bottom)+56px)] sm:pb-0"
    >
      <div
        data-testid="session-header-region"
        className="flex-shrink-0 overflow-hidden bg-background max-h-72 sm:max-h-80"
      >
        <Header className="bg-background">
          <div className="flex items-center gap-1.5 sm:gap-3 min-w-0 flex-1">
            {session?.parentID ? (
              <>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleParentSessionClick}
                  className="text-muted-foreground hover:text-foreground hover:bg-accent h-7 px-2 gap-1"
                  title={t('session.header.backToParent')}
                >
                  <CornerUpLeft className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline text-xs">{t('session.header.parent')}</span>
                </Button>
                <div className="hidden sm:block">
                  <Header.BackButton to={sessionBackPath} className="text-xs sm:text-sm" />
                </div>
              </>
            ) : (
              <Header.BackButton to={sessionBackPath} className="text-xs sm:text-sm" />
            )}
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setRailOpen((open) => !open)}
              aria-label={t('navigation.sessions')}
              title={t('navigation.sessions')}
              className={cn('h-8 w-8 shrink-0', railOpen && 'bg-accent text-foreground')}
            >
              <PanelLeft className="h-4 w-4" />
            </Button>
            <Header.EditableTitle
              value={session?.title || t('session.card.untitled')}
              onChange={handleSessionTitleUpdate}
              subtitle={<span className="text-primary">{workspaceDisplayName}</span>}
            />
          </div>
          <Header.Actions className="gap-2 sm:gap-3">
            <div className="flex items-center gap-1">
              <PendingActionsGroup />
            </div>
            <ContextUsageIndicator
              opcodeUrl={opcodeUrl}
              sessionID={sessionId}
              directory={sessionDirectory}
              isConnected={isConnected}
              isReconnecting={isReconnecting}
            />
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setRightPanelOpen((open) => !open)}
              aria-label={t('navigation.detail')}
              title={t('navigation.detail')}
              className={cn('h-8 w-8', rightPanelOpen && 'bg-accent text-foreground')}
            >
              <PanelRight className="h-4 w-4" />
            </Button>
            <SessionMoreButton />
          </Header.Actions>
        </Header>

        <div className="px-3 sm:px-4">
          <SessionTodoDisplay sessionID={sessionId} />
        </div>
      </div>

      <div className="relative flex flex-1 min-h-0">
        {opcodeUrl && (
          <SessionRail open={railOpen} onClose={() => setRailOpen(false)}>
            <SessionList
              opcodeUrl={opcodeUrl}
              directory={repoDirectory}
              activeSessionID={sessionId || undefined}
              onSelectSession={(sessionID) => {
                navigate(`/repos/${repoId}/sessions/${sessionID}${sessionRouteSuffix}`)
                if (!isDesktop) setRailOpen(false)
              }}
            />
          </SessionRail>
        )}
        <div className="relative flex-1 overflow-hidden flex flex-col">
        <div key={sessionId} data-testid="session-message-scroll" ref={messageContainerRef} className="flex-1 overflow-y-auto overflow-x-hidden overscroll-contain scrollbar-subtle [mask-image:linear-gradient(to_bottom,transparent,black_16px,black)]" style={{ paddingBottom: promptOverlayHeight + inputBottomOffset + PROMPT_OVERLAY_CLEARANCE_PX }}>
          {repoLoading || sessionLoading || messagesLoading ? (
            <MessageSkeleton />
          ) : opcodeUrl && sessionDirectory ? (
            <MessageThread
              scrollRef={messageContainerRef}
              opcodeUrl={opcodeUrl} 
              sessionID={sessionId ?? ''} 
              directory={sessionDirectory}
              messages={messages}
              onFileClick={handleFileClick}
              onChildSessionClick={handleChildSessionClick}
              onUndoMessage={handleUndoMessage}
              model={modelString || undefined}
            />
          ) : null}
        </div>
        {opcodeUrl && sessionDirectory && !isEditingMessage && (
          <div
            ref={promptOverlayRef}
            className="absolute left-0 right-0 flex justify-center"
            style={{ bottom: inputBottomOffset }}
          >
            <div className="relative w-[94%] md:max-w-4xl">
              <div className="absolute -top-9 right-0 z-50 flex flex-col items-end gap-2">
                {ttsEnabled && !hasPromptContent && !isSessionActive && latestPlayableAssistant && (
                  <FloatingTTSButton
                    messageId={latestPlayableAssistant.message.info.id}
                    content={latestPlayableAssistant.text}
                  />
                )}
              </div>
              {leaderActive && (
                <div className="absolute -top-12 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-xl bg-primary/90 text-primary-foreground border border-primary shadow-lg backdrop-blur-md animate-pulse">
                  <span className="text-sm font-medium">{t('session.header.waitingShortcut')}</span>
                </div>
              )}
              {minimizedQuestion && minimizedQuestion.sessionID === sessionId && (
                <MinimizedQuestionIndicator
                  question={minimizedQuestion}
                  onRestore={handleRestoreQuestion}
                  onDismiss={() => rejectQuestion(minimizedQuestion.id)}
                />
              )}
              {!minimizedQuestion && currentQuestion && (
                <QuestionPrompt
                  key={currentQuestion.id}
                  question={currentQuestion}
                  onReply={replyToQuestion}
                  onReject={rejectQuestion}
                  onMinimize={() => handleMinimizeQuestion(currentQuestion)}
                />
              )}
              {/* Six entries, and on a phone there is room for only about five at
                  this size - hence the horizontal scroll rather than a wrap that
                  would push the message list around. The targets are 36px on a
                  phone instead of the 28px they use with a mouse. */}
              <div className="mb-1.5 flex items-center gap-1 overflow-x-auto scrollbar-thin">
                <Button variant="ghost" size="sm" className="h-9 shrink-0 gap-1 px-2 sm:h-7" onClick={() => navigate('/files')}>
                  <Folder className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline">{t('navigation.files')}</span>
                </Button>
                <Button variant="ghost" size="sm" className="h-9 shrink-0 gap-1 px-2 sm:h-7" onClick={() => setSkillsDialogOpen(true)}>
                  <Sparkles className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline">{t('navigation.skills')}</span>
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-9 shrink-0 gap-1 px-2 sm:h-7"
                  onClick={() => setCommandsPanelOpen((open) => !open)}
                  aria-label={t('navigation.commands')}
                  title={t('navigation.commands')}
                  aria-expanded={commandsPanelOpen}
                  data-testid="session-commands-trigger"
                >
                  <CommandIcon className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline">{t('navigation.commands')}</span>
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-9 shrink-0 gap-1 px-2 sm:h-7"
                  onClick={() => setFilesBrowserOpen(true)}
                  aria-label={t('navigation.mentionFile')}
                  title={t('navigation.mentionFile')}
                  data-testid="session-mention-file-trigger"
                >
                  <FileText className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline">{t('navigation.mentionFile')}</span>
                </Button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="sm" className="h-9 shrink-0 gap-1 px-2 sm:h-7" aria-label={t('navigation.more')}>
                      <Plus className="h-3.5 w-3.5" />
                      <span className="hidden sm:inline">{t('navigation.more')}</span>
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start">
                    <DropdownMenuItem onClick={() => setSourceControlOpen(true)}>
                      <GitPullRequest className="h-4 w-4 mr-2" />
                      {t('navigation.sourceControl')}
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => navigate(`/repos/${repoId}/schedules`)}>
                      <CalendarClock className="h-4 w-4 mr-2" />
                      {t('navigation.schedules')}
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => setMcpDialogOpen(true)}>
                      <Plug className="h-4 w-4 mr-2" />
                      {t('navigation.mcp')}
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
                {hasPromptContent && !isSessionActive && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleClearPrompt}
                    className="h-9 shrink-0 gap-1 px-2 sm:h-7 text-destructive hover:bg-destructive/10"
                    aria-label={t('session.header.clear')}
                  >
                    <X className="h-3.5 w-3.5" />
                    <span className="hidden sm:inline">{t('session.header.clear')}</span>
                  </Button>
                )}
              </div>
              {commandsPanelOpen && (
                <div
                  data-testid="session-command-panel"
                  className="mb-1.5 overflow-hidden rounded-lg border border-border bg-background"
                >
                  <div className="flex items-center gap-2 border-b border-border px-2">
                    <CommandIcon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    <input
                      value={commandQuery}
                      onChange={(event) => setCommandQuery(event.target.value)}
                      placeholder={t('navigation.commands')}
                      aria-label={t('navigation.commands')}
                      className="h-8 w-full min-w-0 bg-transparent text-sm outline-none"
                    />
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 shrink-0"
                      onClick={closeCommandsPanel}
                      aria-label={t('navigation.close')}
                    >
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                  <div className="max-h-56 overflow-y-auto p-1">
                    {commandList.length === 0 ? (
                      <p className="px-2 py-3 text-center text-xs text-muted-foreground">
                        {t('navigation.commandsEmpty')}
                      </p>
                    ) : (
                      commandList.map((command) => (
                        <button
                          key={command.name}
                          type="button"
                          onClick={() => handleSelectCommand(command)}
                          className="flex w-full min-w-0 items-start gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-accent"
                        >
                          <span className="font-mono text-sm font-medium text-blue-600 dark:text-blue-400">
                            {command.name}
                          </span>
                          {command.description && (
                            <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                              {command.description}
                            </span>
                          )}
                        </button>
                      ))
                    )}
                  </div>
                </div>
              )}
              <SessionSendErrorBanner sessionId={sessionId} isConnected={isConnected} isReconnecting={isReconnecting} />
              <PromptInput
                ref={promptInputRef}
                opcodeUrl={opcodeUrl}
                directory={sessionDirectory}
                sessionID={sessionId ?? ''}
                ensureSession={ensureSessionForNewConversation}
                showScrollButton={showScrollButton && !hasPromptContent}
                isSessionActive={isSessionActive}
                isStreamingResponse={isStreamingResponse}
                onScrollToBottom={scrollToBottom}
                onShowSessionsDialog={handleShowSessionsDialog}
                onShowHelpDialog={handleShowHelpDialog}
                onToggleDetails={handleToggleDetails}
                onExportSession={handleExportSession}
                onPromptChange={setHasPromptContent}
              />
            </div>
          </div>
        )}
        </div>
        <SessionPanel
          open={rightPanelOpen}
          onOpenChange={setRightPanelOpen}
          isDesktop={isDesktop}
          width={panelWidth}
          onResizeStart={startPanelResize.onMouseDown}
          onResizeTouchStart={startPanelResize.onTouchStart}
          onResizeKey={handlePanelResizeKey}
          tabs={sessionPanelTabs}
          defaultTabIds={DEFAULT_PANEL_TAB_IDS}
          storageKey={STORAGE_KEYS.chatPanelTabs}
        />
      </div>

      {/* Sessions Dialog */}
      <Dialog open={sessionsDialogOpen} onOpenChange={setSessionsDialogOpen}>
        <DialogContent className="max-w-4xl max-h-[80vh]">
          <DialogTitle>{t('session.header.sessionsDialogTitle')}</DialogTitle>
          <div className="overflow-y-auto max-h-[60vh] mt-4">
            {opcodeUrl && (
              <SessionList
                opcodeUrl={opcodeUrl}
                directory={repoDirectory}
                activeSessionID={sessionId || undefined}
                onSelectSession={(sessionID) => {
                  navigate(`/repos/${repoId}/sessions/${sessionID}${sessionRouteSuffix}`)
                  setSessionsDialogOpen(false)
                }}
              />
            )}
          </div>
        </DialogContent>
      </Dialog>

      <RepoOverlays
        repoId={repoId}
        opcodeUrl={opcodeUrl}
        directory={repoDirectory}
        basePath={workspaceBasePath}
        repoName={workspaceDisplayName}
        currentBranch={currentBranch}
        sessionId={sessionId}
        initialSelectedFile={selectedFilePath}
        onFileBrowserClosed={handleFileBrowserClose}
        onFileSelect={handleSelectMentionFile}
        onSkillLoaded={(skill) => showToast.success(t('session.actions.loadedSkill', { name: skill.name }))}
      />

      {!isAssistantSession && (
        <>
          <WorktreeTabs
            workspaces={workspaceSiblings}
            value={activeTab}
            onValueChange={setActiveTab}
            baseLabel={currentBranch}
            activeWorkspaceLabel={
              activeWorkspaceDirectory ? directoryLabels[activeWorkspaceDirectory] : undefined
            }
            onCreateWorkspace={() => setCreateWorkspaceOpen(true)}
            onWorkspaceMenu={handleOpenWorkspaceSelector}
          />

          <WorkspaceManager
            open={workspaceSelectorOpen}
            onOpenChange={setWorkspaceSelectorOpen}
            workspaces={workspaceSiblings}
            activeWorkspaceDirectory={activeWorkspaceDirectory}
            onActiveWorkspaceChange={setActiveWorkspaceDirectory}
            onCreateWorkspace={() => setCreateWorkspaceOpen(true)}
            onDelete={(workspaceIds) => deleteWorkspaces.mutate(workspaceIds)}
            isDeleting={deleteWorkspaces.isPending}
          />

          <CreateWorkspaceDialog
            open={createWorkspaceOpen}
            onOpenChange={setCreateWorkspaceOpen}
            onCreate={handleCreateWorkspace}
            isCreating={createWorkspace.isPending}
          />
        </>
      )}
    </div>
  );
}
