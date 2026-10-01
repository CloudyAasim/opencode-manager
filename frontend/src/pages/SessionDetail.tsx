import { useState } from "react";
import { useParams, useNavigate, Navigate, useLocation } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { getRepo } from "@/api/repos";
import { MessageThread } from "@/components/message/MessageThread";
import { PromptInput, type PromptInputHandle } from "@/components/message/PromptInput";
import { FloatingTTSButton } from '@/components/message/FloatingTTSButton'
import { X, CornerUpLeft, PanelLeft, PanelRight, Plus, Folder, GitPullRequest, CalendarClock, Plug, Sparkles, Info, TerminalSquare } from "lucide-react";
import { Header } from "@/components/ui/header";
import { SessionList } from "@/components/session/SessionList";
import { getSessionListPath } from '@/lib/navigation'
import { FetchError } from '@/api/fetchWrapper'

import { FileBrowserSheet } from "@/features/file-browser/FileBrowserSheet";
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
import { ContextUsageIndicator } from "@/components/session/ContextUsageIndicator";
import { useSession, useAbortSession, useUpdateSession, useMessages, useCreateSession } from "@/hooks/useOpenCode";
import { useRepoActivity } from "@/hooks/useRepoActivity";
import { useRepoSiblings, useCreateRepoWorkspace, useDeleteRepoWorkspaces } from "@/hooks/useRepoSiblings";
import { useWorktreeTab } from "@/hooks/useWorktreeTab";
import { SessionRouteFallback } from "@/components/session/SessionRouteFallback";
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
import { MessageSkeleton } from "@/components/message/MessageSkeleton";
import { exportSession, downloadMarkdown } from "@/lib/exportSession";
import type { MessageWithParts } from "@/api/types";
import { getMessagesContentVersion } from "./sessionContentVersion";
import { showToast } from "@/lib/toast";
import { getRepoDisplayName } from "@/lib/utils";
import { cn } from "@/lib/utils";
import { RepoMcpDialog } from "@/features/repos/RepoMcpDialog";
import { ResetPermissionsDialog } from "@/features/repos/ResetPermissionsDialog";
import { RepoLspDialog } from "@/features/repos/RepoLspDialog";
import { RepoSkillsDialog } from "@/features/repos/RepoSkillsDialog";
import { createOpenCodeClient } from "@/api/opencode";
import { usePermissions, useQuestions } from "@/contexts/EventContext";
import { useSessionStatusForSession } from "@/stores/sessionStatusStore";
import type { QuestionRequest } from "@/api/types";
import { QuestionPrompt } from "@/components/session/QuestionPrompt";
import { MinimizedQuestionIndicator } from "@/components/session/MinimizedQuestionIndicator";
import { PendingActionsGroup } from "@/components/notifications/PendingActionsGroup";
import { SourceControlPanel, ChangesTab } from "@/features/source-control";
import { SessionSendErrorBanner } from "@/components/session/SessionSendErrorBanner";
import { SessionTodoDisplay } from "@/components/message/SessionTodoDisplay";
import { useDialogParam } from "@/hooks/useDialogParam";
import { MEDIA } from '@/framework/shell/breakpoints';
import { useDesktop } from "@/hooks/useDesktop";
import { useSidebarAction } from "@/hooks/useSidebarAction";
import { SessionMoreButton } from "@/features/navigation/SessionMoreButton";
import { useI18n } from "@/lib/i18n";
import { usePersistentNumberState } from "@/hooks/usePersistentNumberState";
import { usePersistentJSONState } from "@/hooks/usePersistentJSONState";
import { STORAGE_KEYS } from "@/lib/storage-keys";
import {
  SESSION_RAIL_WIDTH_MIN,
  SESSION_RAIL_WIDTH_MAX,
  SESSION_RAIL_WIDTH_DEFAULT,
  CHAT_PANEL_WIDTH_MIN,
  CHAT_PANEL_WIDTH_MAX,
  CHAT_PANEL_WIDTH_DEFAULT,
  FILE_TREE_WIDTH_MIN,
  FILE_TREE_WIDTH_MAX,
  FILE_TREE_WIDTH_DEFAULT,
  DEFAULT_REPO_BRANCH,
} from "@/lib/repo-constants";

type PanelTab = 'files' | 'review' | 'info' | 'terminal'
const ALL_PANEL_TABS: PanelTab[] = ['files', 'review', 'info', 'terminal']
const PANEL_TAB_LABEL_KEY: Record<PanelTab, string> = {
  files: 'navigation.files',
  review: 'navigation.sourceControl',
  info: 'navigation.detail',
  terminal: 'navigation.terminal',
}

const DEFAULT_PANEL_TABS: PanelTab[] = ['files', 'review', 'info']

function isPanelTabs(value: unknown): value is PanelTab[] {
  if (!Array.isArray(value)) return false
  const valid = value.filter((tab): tab is PanelTab => (ALL_PANEL_TABS as string[]).includes(tab as string))
  return valid.length > 0 && valid.length === value.length
}

function PanelTabIcon({ tab }: { tab: PanelTab }) {
  const cls = 'h-3.5 w-3.5'
  if (tab === 'review') return <GitPullRequest className={cls} />
  if (tab === 'info') return <Info className={cls} />
  if (tab === 'terminal') return <TerminalSquare className={cls} />
  return <Folder className={cls} />
}

const compareMessageIds = (id1: string, id2: string): number => {
  const num1 = parseInt(id1, 10)
  const num2 = parseInt(id2, 10)
  if (!isNaN(num1) && !isNaN(num2)) return num1 - num2
  return id1.localeCompare(id2)
}

const PENDING_ACTION_SYNC_INTERVAL_MS = 30000
const PROMPT_OVERLAY_CLEARANCE_PX = 16

export function SessionDetail() {
  const { t } = useI18n();
  const { id, sessionId } = useParams<{ id: string; sessionId: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const repoId = Number(id) || 0;
  const isAssistantSession = new URLSearchParams(location.search).get('assistant') === '1';
  const { preferences, updateSettings } = useSettings();
  const openSettings = useCallback(() => navigate('/settings'), [navigate]);
  const isDesktop = useDesktop();
  const messageContainerRef = useRef<HTMLDivElement>(null);
  const promptInputRef = useRef<PromptInputHandle>(null);
  const [sessionsDialogOpen, setSessionsDialogOpen] = useDialogParam('sessions');
  const [fileBrowserOpen, setFileBrowserOpen] = useDialogParam('files');
  const [lspDialogOpen, setLspDialogOpen] = useDialogParam('lsp');
  const [mcpDialogOpen, setMcpDialogOpen] = useDialogParam('mcp');
  const [skillsDialogOpen, setSkillsDialogOpen] = useDialogParam('skills');
  const [sourceControlOpen, setSourceControlOpen] = useDialogParam('sourceControl');
  const [resetPermissionsOpen, setResetPermissionsOpen] = useDialogParam('resetPermissions');
  const [railWidth, setRailWidth] = usePersistentNumberState({
    storageKey: STORAGE_KEYS.sessionRailWidth,
    defaultValue: SESSION_RAIL_WIDTH_DEFAULT,
    min: SESSION_RAIL_WIDTH_MIN,
    max: SESSION_RAIL_WIDTH_MAX,
  })
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
  const [panelTabs, setPanelTabs] = usePersistentJSONState<PanelTab[]>({
    storageKey: STORAGE_KEYS.chatPanelTabs,
    defaultValue: DEFAULT_PANEL_TABS,
    validate: isPanelTabs,
  })
  const [rightTab, setRightTab] = useState<PanelTab>('files')
  const [panelFile, setPanelFile] = useState<FileInfo | null>(null)
  const [treeWidth, setTreeWidth] = usePersistentNumberState({
    storageKey: STORAGE_KEYS.fileTreeWidth,
    defaultValue: FILE_TREE_WIDTH_DEFAULT,
    min: FILE_TREE_WIDTH_MIN,
    max: FILE_TREE_WIDTH_MAX,
  })
  const filesPanelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!panelTabs.includes(rightTab)) setRightTab(panelTabs[0])
  }, [panelTabs, rightTab])

  const removePanelTab = useCallback((tab: PanelTab) => {
    setPanelTabs((tabs) => (tabs.length > 1 ? tabs.filter((existing) => existing !== tab) : tabs))
  }, [setPanelTabs])

  const addPanelTab = useCallback((tab: PanelTab) => {
    setPanelTabs((tabs) => (tabs.includes(tab) ? tabs : [...tabs, tab]))
    setRightTab(tab)
  }, [setPanelTabs])

  const startTreeResize = useCallback((event: React.MouseEvent) => {
    event.preventDefault()
    const container = filesPanelRef.current
    if (!container) return
    const rect = container.getBoundingClientRect()
    const onMove = (moveEvent: MouseEvent) => {
      const percentage = ((moveEvent.clientX - rect.left) / rect.width) * 100
      setTreeWidth(percentage)
    }
    const onUp = () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }, [setTreeWidth])

  const startRailResize = useCallback((event: React.MouseEvent) => {
    event.preventDefault()
    const startX = event.clientX
    const startWidth = railWidth
    const onMove = (moveEvent: MouseEvent) => {
      setRailWidth(startWidth + moveEvent.clientX - startX)
    }
    const onUp = () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }, [railWidth, setRailWidth])

  const startPanelResize = useCallback((event: React.MouseEvent | React.TouchEvent) => {
    event.preventDefault()
    const startX = 'touches' in event ? event.touches[0]?.clientX ?? 0 : event.clientX
    const startWidth = panelWidth
    const onMove = (moveEvent: MouseEvent | TouchEvent) => {
      const currentX = 'touches' in moveEvent
        ? moveEvent.touches[0]?.clientX ?? startX
        : (moveEvent as MouseEvent).clientX
      setPanelWidth(startWidth - (currentX - startX))
    }
    const onUp = () => {
      window.removeEventListener('mousemove', onMove as EventListener)
      window.removeEventListener('mouseup', onUp)
      window.removeEventListener('touchmove', onMove as EventListener)
      window.removeEventListener('touchend', onUp)
    }
    window.addEventListener('mousemove', onMove as EventListener)
    window.addEventListener('mouseup', onUp)
    window.addEventListener('touchmove', onMove as EventListener, { passive: false })
    window.addEventListener('touchend', onUp)
  }, [panelWidth, setPanelWidth])

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
  const [createWorkspaceOpen, setCreateWorkspaceOpen] = useDialogParam('createWorkspace');
  const [workspaceSelectorOpen, setWorkspaceSelectorOpen] = useDialogParam('workspaceSelector');
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
  }, [createWorkspace, setActiveTab]);

  const handleOpenWorkspaceSelector = useCallback(() => {
    if (workspaceSiblings.length === 0) {
      setCreateWorkspaceOpen(true);
      return;
    }
    setActiveTab('workspaces');
    setWorkspaceSelectorOpen(true);
  }, [workspaceSiblings.length, setActiveTab]);

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
  const { model, modelString } = useModelSelection(opcodeUrl, sessionDirectory);
  const isEditingMessage = useUIState((state) => state.isEditingMessage);
  const setActivePromptFileBasePath = useUIState((state) => state.setActivePromptFileBasePath);
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

  const handleShowSessionsDialog = useCallback(() => setSessionsDialogOpen(true), []);
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

  useSidebarAction('new-session', () => {
    handleNewSession();
  });

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
    openModelDialog: () => {
      const modelSelectTrigger = document.querySelector(
        "[data-model-select-trigger]",
      ) as HTMLElement;
      modelSelectTrigger?.click();
    },
    openSessions: () => setSessionsDialogOpen(true),
    openSettings,
    newSession: handleNewSession,
    closeSession: handleCloseSession,
    compact: handleCompact,
    undo: handleUndo,
    redo: handleRedo,
    fork: handleFork,
    toggleSidebar: () => setFileBrowserOpen(!fileBrowserOpen),
    toggleMode: () => {
      const modeButton = document.querySelector(
        "[data-toggle-mode]",
      ) as HTMLButtonElement;
      modeButton?.click();
    },
    submitPrompt: () => {
      const submitButton = document.querySelector(
        "[data-submit-prompt]",
      ) as HTMLButtonElement;
      submitButton?.click();
    },
    abortSession: () => {
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
    setFileBrowserOpen(false)
    setSelectedFilePath(undefined)
  }, [setFileBrowserOpen]);

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

  

  

  if (!sessionId) {
    return <Navigate to="/" replace />;
  }

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

  if (sessionQueryError instanceof FetchError && sessionQueryError.statusCode === 404) {
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
        {opcodeUrl && railOpen && (
          <>
            {!isDesktop && (
              <button
                type="button"
                aria-label={t('navigation.close')}
                onClick={() => setRailOpen(false)}
                className="absolute inset-0 z-30 bg-black/40 transition-opacity duration-200 md:hidden"
              />
            )}
            <aside
              className="absolute inset-y-0 left-0 z-40 flex w-[82%] max-w-xs shrink-0 flex-col overflow-hidden border-r border-border bg-card shadow-xl transition-transform duration-200 ease-out md:static md:z-auto md:w-auto md:max-w-none md:bg-transparent md:shadow-none"
              style={isDesktop ? { width: railWidth } : undefined}
            >
              <div className="min-h-0 flex-1 overflow-hidden">
                <SessionList
                  opcodeUrl={opcodeUrl}
                  directory={repoDirectory}
                  activeSessionID={sessionId || undefined}
                  onSelectSession={(sessionID) => {
                    navigate(`/repos/${repoId}/sessions/${sessionID}${sessionRouteSuffix}`)
                    if (!isDesktop) setRailOpen(false)
                  }}
                />
              </div>
            </aside>
            {isDesktop && (
              <div
                role="separator"
                aria-orientation="vertical"
                onMouseDown={startRailResize}
                className="hidden md:block w-1 shrink-0 cursor-col-resize bg-border/40 transition-colors hover:bg-primary/40"
              />
            )}
          </>
        )}
        <div className="relative flex-1 overflow-hidden flex flex-col">
        <div key={sessionId} data-testid="session-message-scroll" ref={messageContainerRef} className="flex-1 overflow-y-auto overflow-x-hidden overscroll-contain scrollbar-subtle [mask-image:linear-gradient(to_bottom,transparent,black_16px,black)]" style={{ paddingBottom: promptOverlayHeight + inputBottomOffset + PROMPT_OVERLAY_CLEARANCE_PX }}>
          {repoLoading || sessionLoading || messagesLoading ? (
            <MessageSkeleton />
          ) : opcodeUrl && sessionDirectory ? (
            <MessageThread
              scrollRef={messageContainerRef}
              opcodeUrl={opcodeUrl} 
              sessionID={sessionId} 
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
              <div className="mb-1.5 flex items-center gap-1">
                <Button variant="ghost" size="sm" className="h-7 shrink-0 gap-1 px-2" onClick={() => navigate('/files')}>
                  <Folder className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline">{t('navigation.files')}</span>
                </Button>
                <Button variant="ghost" size="sm" className="h-7 shrink-0 gap-1 px-2" onClick={() => setSkillsDialogOpen(true)}>
                  <Sparkles className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline">{t('navigation.skills')}</span>
                </Button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="sm" className="h-7 shrink-0 gap-1 px-2" aria-label={t('navigation.more')}>
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
                    className="h-7 shrink-0 gap-1 px-2 text-destructive hover:bg-destructive/10"
                    aria-label={t('session.header.clear')}
                  >
                    <X className="h-3.5 w-3.5" />
                    <span className="hidden sm:inline">{t('session.header.clear')}</span>
                  </Button>
                )}
              </div>
              <SessionSendErrorBanner sessionId={sessionId} isConnected={isConnected} isReconnecting={isReconnecting} />
              <PromptInput
                ref={promptInputRef}
                opcodeUrl={opcodeUrl}
                directory={sessionDirectory}
                sessionID={sessionId}
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
        {rightPanelOpen && (
          <>
          {isDesktop && (
            <div
              role="separator"
              aria-orientation="vertical"
              aria-label={t('navigation.resizePanel')}
              tabIndex={0}
              onMouseDown={startPanelResize}
              onTouchStart={startPanelResize}
              onKeyDown={handlePanelResizeKey}
              className="absolute inset-y-0 z-20 hidden w-2 cursor-col-resize bg-transparent transition-colors hover:bg-primary/40 focus-visible:bg-primary/40 md:block"
              style={{ right: panelWidth }}
            />
          )}
          {!isDesktop && (
            <button
              type="button"
              aria-label={t('navigation.close')}
              onClick={() => setRightPanelOpen(false)}
              className="absolute inset-0 z-30 bg-black/40 transition-opacity duration-200 md:hidden"
            />
          )}
          <aside
            className="absolute inset-x-0 bottom-0 z-40 flex max-h-[78vh] shrink-0 flex-col overflow-hidden rounded-t-xl border-t border-border bg-card shadow-[0_-12px_32px_rgba(0,0,0,0.18)] transition-transform duration-200 ease-out md:inset-y-0 md:right-0 md:left-auto md:z-auto md:max-h-none md:w-auto md:rounded-none md:border-l md:border-t-0 md:bg-transparent md:shadow-none"
            style={isDesktop ? { width: panelWidth } : undefined}
          >
            <div className="flex shrink-0 items-center gap-1 overflow-x-auto border-b border-border px-2 py-1.5 scrollbar-thin">
              {panelTabs.map((tab) => (
                <div key={tab} className="group flex shrink-0 items-center">
                  <Button
                    variant={rightTab === tab ? 'secondary' : 'ghost'}
                    size="sm"
                    className={cn('h-7 gap-1 px-2', panelTabs.length > 1 && 'rounded-r-none')}
                    onClick={() => setRightTab(tab)}
                  >
                    <PanelTabIcon tab={tab} />
                    {t(PANEL_TAB_LABEL_KEY[tab])}
                  </Button>
                  {panelTabs.length > 1 && (
                    <button
                      type="button"
                      onClick={() => removePanelTab(tab)}
                      aria-label={t('navigation.remove')}
                      className="h-7 rounded-r-md px-1 text-muted-foreground opacity-0 transition-opacity hover:text-foreground group-hover:opacity-100"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  )}
                </div>
              ))}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" aria-label={t('navigation.add')} title={t('navigation.add')}>
                    <Plus className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {ALL_PANEL_TABS.filter((tab) => !panelTabs.includes(tab)).map((tab) => (
                    <DropdownMenuItem key={tab} onClick={() => addPanelTab(tab)}>
                      <span className="mr-2"><PanelTabIcon tab={tab} /></span>
                      {t(PANEL_TAB_LABEL_KEY[tab])}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
              <Button variant="ghost" size="icon" className="ml-auto h-7 w-7 shrink-0" onClick={() => setRightPanelOpen(false)} aria-label={t('navigation.close')}>
                <X className="h-4 w-4" />
              </Button>
            </div>
            <div className="min-h-0 flex-1 overflow-hidden">
              {rightTab === 'files' && (
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
                    onMouseDown={startTreeResize}
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
              )}
              {rightTab === 'review' && (
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
                    <ChangesTab repoId={repoId} onFileSelect={(path, staged) => setReviewFile({ path, staged })} isMobile={false} />
                  )}
                </div>
              )}
              {rightTab === 'info' && (
                <ProjectInfoPanel
                  repoId={repoId}
                  name={workspaceDisplayName}
                  directory={repoDirectory}
                  branch={repo?.currentBranch || repo?.branch}
                />
              )}
              {rightTab === 'terminal' && (
                <div className="h-full min-h-0">
                  <TerminalView className="h-full" cwd={repoDirectory} />
                </div>
              )}
            </div>
          </aside>
          </>
        )}
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

      <FileBrowserSheet
        isOpen={fileBrowserOpen}
        onClose={handleFileBrowserClose}
        basePath={workspaceBasePath}
        repoName={workspaceDisplayName}
        repoId={repoId}
        initialSelectedFile={selectedFilePath}
      />

      <RepoLspDialog
        open={lspDialogOpen}
        onOpenChange={setLspDialogOpen}
        opcodeUrl={opcodeUrl}
        directory={repoDirectory}
      />

      {opcodeUrl && sessionId && (
        <RepoSkillsDialog
          open={skillsDialogOpen}
          onOpenChange={setSkillsDialogOpen}
          repoId={repoId}
          sessionId={sessionId}
          opcodeUrl={opcodeUrl}
          directory={repoDirectory}
          onSkillLoaded={(skill) => showToast.success(t('session.actions.loadedSkill', { name: skill.name }))}
        />
      )}

      <RepoMcpDialog
        open={mcpDialogOpen}
        onOpenChange={setMcpDialogOpen}
        directory={repoDirectory}
      />

      <SourceControlPanel
        repoId={repoId}
        isOpen={sourceControlOpen}
        onClose={() => setSourceControlOpen(false)}
        currentBranch={currentBranch}
        repoName={workspaceDisplayName}
      />

      <ResetPermissionsDialog
        open={resetPermissionsOpen}
        onOpenChange={setResetPermissionsOpen}
        repoId={repoId}
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
