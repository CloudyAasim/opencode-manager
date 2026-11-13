/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useEffect, useState, useCallback, useMemo, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQueryClient, useQuery } from '@tanstack/react-query'
import { createBffClient } from '@/api/bff'
import { toPendingPermission, toPendingQuestion } from '@/api/pending'
import { listRepos } from '@/api/repos'
import type { PendingPermission, PendingQuestion } from '@opencode-manager/shared/api/v1'
import type { PermissionResponse, SSEEvent, SSHHostKeyRequest, Repo } from '@/api/types'
import { showToast } from '@/lib/toast'
import { openCodeEventStream, type EventStreamHealthState } from '@/lib/opencode-event-stream'
import { API_BASE_URL } from '@/config'
import { addToSessionKeyedState, removeFromSessionKeyedState } from '@/lib/sessionKeyedState'
import { invalidateRepoGitCachesDebounced, isSessionListQueryKey } from '@/lib/queryInvalidation'
import { optimisticallyErrorToolPart } from '@/lib/optimisticToolError'
import { useI18n } from '@/lib/i18n'

type PermissionsBySession = Record<string, PendingPermission[]>
type QuestionsBySession = Record<string, PendingQuestion[]>
type SSEHealthState = Pick<EventStreamHealthState, 'isConnected' | 'isHealthy' | 'isStalled'>

type SessionScopedItem = { id: string; sessionId: string }

function groupBySession<T extends SessionScopedItem>(items: T[]): Record<string, T[]> {
  return items.reduce<Record<string, T[]>>((grouped, item) => {
    const existing = grouped[item.sessionId] ?? []
    return {
      ...grouped,
      [item.sessionId]: [...existing, item],
    }
  }, {})
}

function sortById<T extends SessionScopedItem>(items: T[]): T[] {
  return [...items].sort((a, b) => a.id.localeCompare(b.id))
}

function normalizeDirectory(directory?: string | null) {
  return directory?.replace(/\/+$/, '') ?? null
}

function repoMatchesDirectory(repo: Repo, directory?: string | null) {
  const normalizedDirectory = normalizeDirectory(directory)
  if (!normalizedDirectory) return false

  return [repo.fullPath, repo.localPath, repo.sourcePath]
    .some((path) => normalizeDirectory(path) === normalizedDirectory)
}

/**
 * The answer the server gave, put next to what the app already had.
 *
 * A session the answer mentions has the answer's requests and nothing else.
 * A session the answer does not mention is gone - but only if it belonged to
 * one of the directories that were asked about, because the answer says
 * nothing about the directories that were not.
 */
function reconcileBySessionForDirectories<T extends SessionScopedItem>(
  prev: Record<string, T[]>,
  directories: string[],
  items: T[],
  sessionDirectories: Map<string, string>,
): Record<string, T[]> {
  const grouped = groupBySession(items)
  const next = { ...prev }

  for (const sessionId of Object.keys(prev)) {
    if (grouped[sessionId]) continue
    const directory = sessionDirectories.get(sessionId)
    if (directory && directories.includes(directory)) {
      delete next[sessionId]
    }
  }

  for (const [sessionId, sessionItems] of Object.entries(grouped)) {
    next[sessionId] = sortById(sessionItems)
  }

  return next
}

interface SSHHostKeyState {
  request: SSHHostKeyRequest | null
  respond: (requestId: string, approved: boolean) => Promise<void>
}

interface EventContextValue {
  sshHostKey: SSHHostKeyState
  permissions: {
    current: PendingPermission | null
    pendingCount: number
    respond: (permissionID: string, sessionID: string, response: PermissionResponse) => Promise<void>
    dismiss: (permissionID: string, sessionID?: string) => void
    getForCallID: (callID: string, sessionID: string) => PendingPermission | null
    hasForSession: (sessionID: string) => boolean
    showDialog: boolean
    setShowDialog: (show: boolean) => void
    navigateToCurrent: () => void
    syncForSession: (directory: string, sessionID: string) => Promise<void>
  }
  questions: {
    current: PendingQuestion | null
    pendingCount: number
    reply: (requestID: string, answers: string[][]) => Promise<void>
    reject: (requestID: string) => Promise<void>
    dismiss: (requestID: string, sessionID?: string) => void
    getForCallID: (callID: string, sessionID: string) => PendingQuestion | null
    getForSession: (sessionID: string) => PendingQuestion | null
    hasForSession: (sessionID: string) => boolean
    navigateToCurrent: () => void
    syncForSession: (directory: string, sessionID: string) => Promise<void>
  }
  sseHealth: SSEHealthState
  getRepoIdForSession: (sessionID: string) => number | null
  /**
   * Where a conversation is, when the app happens to know.
   *
   * It is a fallback for the layer, not the answer: the layer works out where
   * a conversation lives on its own.
   */
  getSessionDirectory: (sessionID: string) => string | null
}

const EventContext = createContext<EventContextValue | null>(null)

export function EventProvider({ children }: { children: React.ReactNode }) {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const { t } = useI18n()

  const [sshHostKeyRequest, setSSHHostKeyRequest] = useState<SSHHostKeyRequest | null>(null)
  const [sseHealth, setSseHealth] = useState<SSEHealthState>(() => {
    const { isConnected, isHealthy, isStalled } = openCodeEventStream.getHealth()
    return { isConnected, isHealthy, isStalled }
  })

  const respondToSSHHostKey = useCallback(async (requestId: string, approved: boolean) => {
    try {
      const { respondSSHHostKey } = await import('@/api/ssh')
      await respondSSHHostKey(requestId, approved)
      setSSHHostKeyRequest(null)
    } catch {
      showToast.error(t('misc.ssh.respondFailed'))
    }
  }, [t])

  // handleHealthChange is declared long before fetchInitialPendingData exists,
  // so it reaches it through a ref rather than pretending a forward reference
  // works.
  const fetchInitialPendingDataRef = useRef<(() => Promise<void>) | null>(null)

  // Edge-triggered on purpose. onHealthChange fires on every heartbeat and on
  // every message, so reacting to the level would fetch pending data
  // continuously for as long as the stream is merely unhappy.
  const sseWasHealthyRef = useRef(true)

  const handleHealthChange = useCallback((next: EventStreamHealthState) => {
    const wentUnhealthy = sseWasHealthyRef.current && !next.isHealthy
    sseWasHealthyRef.current = next.isHealthy

    setSseHealth((prev) => {
      if (prev.isConnected === next.isConnected && prev.isHealthy === next.isHealthy && prev.isStalled === next.isStalled) {
        return prev
      }
      return { isConnected: next.isConnected, isHealthy: next.isHealthy, isStalled: next.isStalled }
    })

    // The first sign that the stream has stopped delivering is this event.
    // Fetch the truth now rather than waiting for the next poll tick: the poll
    // is the safety net, this is the actual repair.
    if (wentUnhealthy) void fetchInitialPendingDataRef.current?.()
  }, [])

  const [permissionsBySession, setPermissionsBySession] = useState<PermissionsBySession>({})
  const [questionsBySession, setQuestionsBySession] = useState<QuestionsBySession>({})
  const [showPermissionDialog, setShowPermissionDialog] = useState(true)

  const sessionDirectoriesRef = useRef<Map<string, string>>(new Map())
  const prevPermissionCountRef = useRef(0)
  const initialFetchDoneRef = useRef(false)
  const subscriptionRef = useRef<ReturnType<typeof openCodeEventStream.subscribeGlobalMonitor> | null>(null)
  const reposRef = useRef<typeof repos>(null)

  const { data: repos } = useQuery({
    queryKey: ['repos'],
    queryFn: listRepos,
  })

  const allPermissions = useMemo(() => Object.values(permissionsBySession).flat(), [permissionsBySession])
  const allQuestions = useMemo(() => Object.values(questionsBySession).flat(), [questionsBySession])

  const currentPermission = allPermissions[0] ?? null
  const currentQuestion = allQuestions[0] ?? null

  const rememberSessionDirectory = useCallback((sessionID: string, directory?: string) => {
    if (!directory) return
    sessionDirectoriesRef.current.set(sessionID, directory)
  }, [])


  const findSessionDirectory = useCallback((sessionID: string): string | null => {
    const remembered = sessionDirectoriesRef.current.get(sessionID)
    if (remembered) return remembered

    const cache = queryClient.getQueryCache()
    const queries = cache.getAll()

    for (const query of queries) {
      const key = query.queryKey
      if (key[0] === 'opencode' && key[1] === 'session' && key.length >= 5) {
        const sessionData = query.state.data as { id: string } | undefined
        if (sessionData?.id === sessionID) {
          const directory = key[4] as string
          if (directory) return directory
        }
      }
    }

    for (const query of queries) {
      const key = query.queryKey
      if (isSessionListQueryKey(key)) {
        const sessionsData = query.state.data
        if (!sessionsData) continue

        if (Array.isArray(sessionsData)) {
          const found = sessionsData.find((s: { id: string }) => s.id === sessionID)
          if (found) {
            const directory = (found as { directory?: string | null }).directory
            if (directory) return directory
          }
          continue
        }

        if (typeof sessionsData === 'object' && 'pages' in sessionsData) {
          const infiniteData = sessionsData as { pages: Array<{ items: Array<{ id: string; directory?: string | null }> }> }
          for (const page of infiniteData.pages) {
            if (!page.items) continue
            const found = page.items.find(s => s.id === sessionID)
            if (found && found.directory) return found.directory
          }
        }
      }
    }

    return null
  }, [queryClient])

  /**
   * The working directory a conversation is in, as a fallback.
   *
   * The layer works out where a conversation lives - the ledger knows, or the
   * agent knows. What the app offers here is only what it happens to have
   * noticed, and the layer's answer does not depend on it: it is a fallback,
   * not the answer.
   */
  const directoriesOf = useCallback((sessionID: string): string[] => {
    const directory = findSessionDirectory(sessionID)
    return directory ? [directory] : []
  }, [findSessionDirectory])

  const getRepoIdForSession = useCallback((sessionID: string): number | null => {
    if (!repos) return null
    const directory = findSessionDirectory(sessionID)
    if (!directory) return null
    const repo = repos.find(r => repoMatchesDirectory(r, directory))
    return repo?.id ?? null
  }, [repos, findSessionDirectory])

  const addPermission = useCallback((permission: PendingPermission) => {
    addToSessionKeyedState(setPermissionsBySession, permission)
  }, [])

  const removePermission = useCallback((permissionID: string, sessionID?: string) => {
    removeFromSessionKeyedState(setPermissionsBySession, permissionID, sessionID)
  }, [])

  const addQuestion = useCallback((question: PendingQuestion) => {
    addToSessionKeyedState(setQuestionsBySession, question)
  }, [])

  const removeQuestion = useCallback((requestID: string, sessionID?: string) => {
    removeFromSessionKeyedState(setQuestionsBySession, requestID, sessionID)
  }, [])

  /**
   * The answer of the layer, put next to what the app already had.
   *
   * The requests know the directory they were asked about, so the app does
   * not have to work it out - and it does not have to ask the agent for each
   * directory by itself.
   */
  const reconcilePermissions = useCallback((
    permissions: PendingPermission[],
    directories: string[],
  ) => {
    permissions.forEach(permission => {
      if (permission.directory) {
        rememberSessionDirectory(permission.sessionId, permission.directory)
      }
    })

    setPermissionsBySession(prev =>
      reconcileBySessionForDirectories(
        prev,
        directories,
        permissions,
        sessionDirectoriesRef.current,
      ),
    )
  }, [rememberSessionDirectory])

  const reconcileQuestions = useCallback((
    questions: PendingQuestion[],
    directories: string[],
  ) => {
    questions.forEach(question => {
      if (question.directory) {
        rememberSessionDirectory(question.sessionId, question.directory)
      }
    })

    setQuestionsBySession(prev =>
      reconcileBySessionForDirectories(
        prev,
        directories,
        questions,
        sessionDirectoriesRef.current,
      ),
    )
  }, [rememberSessionDirectory])

  useEffect(() => {
    const permissionCount = allPermissions.length
    if (permissionCount > prevPermissionCountRef.current && permissionCount > 0 && !showPermissionDialog) {
      showToast.info(
        t('session.permissions', { count: permissionCount }),
        {
        duration: 5000,
        action: {
          label: t('session.permissions.viewAction'),
          onClick: () => setShowPermissionDialog(true),
        },
      })
    }
    prevPermissionCountRef.current = permissionCount
  }, [allPermissions.length, showPermissionDialog, t])

  // Take the prompt off screen before the round trip, not after. On a slow
  // link, waiting first leaves the dialog sitting there for seconds after
  // you tapped Allow, and the whole thing feels dead. The removal is local
  // state; if the send fails it goes back, and the periodic reconcile would
  // bring it back anyway.
  const respondToPermission = useCallback(async (permissionID: string, sessionID: string, response: PermissionResponse) => {
    const permission = (permissionsBySession[sessionID] ?? []).find(p => p.id === permissionID)
    if (response === 'reject' && permission?.tool) {
      optimisticallyErrorToolPart(queryClient, sessionID, permission.tool.messageId, permission.tool.callId, 'Permission denied')
    }

    removePermission(permissionID, sessionID)
    try {
      await createBffClient(API_BASE_URL).respondToPermission(
        sessionID,
        permissionID,
        response,
        directoriesOf(sessionID),
      )
    } catch (error) {
      if (permission) addPermission(permission)
      throw error
    }
  }, [permissionsBySession, queryClient, removePermission, addPermission, directoriesOf])

  const replyToQuestion = useCallback(async (requestID: string, answers: string[][]) => {
    const question = Object.values(questionsBySession).flat().find(q => q.id === requestID)
    if (!question) throw new Error('Question not found')
    removeQuestion(requestID, question.sessionId)
    try {
      await createBffClient(API_BASE_URL).replyToQuestion(
        question.sessionId,
        requestID,
        answers,
        directoriesOf(question.sessionId),
      )
    } catch (error) {
      addQuestion(question)
      throw error
    }
  }, [questionsBySession, removeQuestion, addQuestion, directoriesOf])

  const rejectQuestion = useCallback(async (requestID: string) => {
    const question = Object.values(questionsBySession).flat().find(q => q.id === requestID)
    if (!question) throw new Error('Question not found')

    if (question.tool) {
      optimisticallyErrorToolPart(queryClient, question.sessionId, question.tool.messageId, question.tool.callId, 'Question rejected')
    }

    removeQuestion(requestID, question.sessionId)
    try {
      await createBffClient(API_BASE_URL).rejectQuestion(
        question.sessionId,
        requestID,
        directoriesOf(question.sessionId),
      )
    } catch (error) {
      addQuestion(question)
      throw error
    }
  }, [questionsBySession, queryClient, removeQuestion, addQuestion, directoriesOf])

  const getPermissionForCallID = useCallback((callID: string, sessionID: string): PendingPermission | null => {
    const perms = permissionsBySession[sessionID] ?? []
    return perms.find(p => {
      const metadata = p.metadata as { tool?: { id?: string } } | undefined
      return p.tool?.callId === callID || metadata?.tool?.id === callID
    }) ?? null
  }, [permissionsBySession])

  const getQuestionForCallID = useCallback((callID: string, sessionID: string): PendingQuestion | null => {
    const questions = questionsBySession[sessionID] ?? []
    return questions.find(q => q.tool?.callId === callID) ?? null
  }, [questionsBySession])

  const hasPermissionsForSession = useCallback((sessionID: string): boolean => {
    return (permissionsBySession[sessionID]?.length ?? 0) > 0
  }, [permissionsBySession])

  const getQuestionForSession = useCallback((sessionID: string): PendingQuestion | null => {
    return questionsBySession[sessionID]?.[0] ?? null
  }, [questionsBySession])

  const hasQuestionsForSession = useCallback((sessionID: string): boolean => {
    return (questionsBySession[sessionID]?.length ?? 0) > 0
  }, [questionsBySession])

  const navigateToCurrentQuestion = useCallback(() => {
    if (!currentQuestion) return
    const repoId = getRepoIdForSession(currentQuestion.sessionId)
    if (repoId) {
      const targetPath = `/repos/${repoId}/sessions/${currentQuestion.sessionId}`
      if (window.location.pathname !== targetPath) {
        navigate(targetPath)
      }
    }
  }, [currentQuestion, getRepoIdForSession, navigate])

  const navigateToCurrentPermission = useCallback(() => {
    if (!currentPermission) return
    const repoId = getRepoIdForSession(currentPermission.sessionId)
    if (repoId) {
      const targetPath = `/repos/${repoId}/sessions/${currentPermission.sessionId}`
      if (window.location.pathname !== targetPath) {
        navigate(targetPath)
      }
    }
  }, [currentPermission, getRepoIdForSession, navigate])

  const fetchInitialPendingData = useCallback(async () => {
    const reposToUse = reposRef.current
    if (!reposToUse || reposToUse.length === 0) return

    const uniqueDirectories = [...new Set(reposToUse.map(r => r.fullPath))]

    // One request for every directory. The client used to ask the agent for
    // the pending permissions of each directory and the pending questions of
    // each directory - two requests per directory - and merge the answers
    // itself. That is the server's job, and it moved to the layer the client
    // talks to.
    try {
      const pending = await createBffClient(API_BASE_URL).listPending(uniqueDirectories)
      reconcilePermissions(pending.permissions, uniqueDirectories)
      reconcileQuestions(pending.questions, uniqueDirectories)
    } catch {
      // A directory that cannot be asked does not take the others with it.
      // The stream will bring the news when it comes.
    }
  }, [reconcilePermissions, reconcileQuestions])

  fetchInitialPendingDataRef.current = fetchInitialPendingData

  const syncPermissionsForSession = useCallback(async (directory: string, sessionID: string) => {
    const pending = await createBffClient(API_BASE_URL).listPending([directory])
    rememberSessionDirectory(sessionID, directory)
    reconcilePermissions(pending.permissions, [directory])
  }, [rememberSessionDirectory, reconcilePermissions])

  const syncQuestionsForSession = useCallback(async (directory: string, sessionID: string) => {
    const pending = await createBffClient(API_BASE_URL).listPending([directory])
    rememberSessionDirectory(sessionID, directory)
    reconcileQuestions(pending.questions, [directory])
  }, [rememberSessionDirectory, reconcileQuestions])

  useEffect(() => {
    const handleSSEMessage = (data: unknown) => {
      if (!data || typeof data !== 'object' || !('type' in data)) return
      
      const event = data as SSEEvent
      
      switch (event.type) {
        case 'permission.asked':
          if ('permission' in event.properties && 'sessionID' in event.properties) {
            rememberSessionDirectory(event.properties.sessionID as string, event.directory)
            // The stream speaks the agent's dialect; the app keeps the
            // versioned one, so the two meet here and only here.
            addPermission(toPendingPermission(event.properties, event.directory))
          }
          break
        case 'permission.replied':
          if ('requestID' in event.properties && 'sessionID' in event.properties) {
            removePermission(
              event.properties.requestID as string,
              event.properties.sessionID as string
            )
          }
          break
        case 'question.asked':
          if ('questions' in event.properties && 'sessionID' in event.properties && 'id' in event.properties) {
            rememberSessionDirectory(event.properties.sessionID as string, event.directory)
            addQuestion(toPendingQuestion(event.properties, event.directory))
          }
          break
        case 'ssh.host-key-request':
          if ('requestId' in event.properties && 'host' in event.properties) {
            setSSHHostKeyRequest(event.properties as SSHHostKeyRequest)
          }
          break
        case 'question.replied':
        case 'question.rejected':
          if ('requestID' in event.properties && 'sessionID' in event.properties) {
            const sessionID = event.properties.sessionID as string
            removeQuestion(
              event.properties.requestID as string,
              sessionID
            )
            queryClient.invalidateQueries({ 
              queryKey: ['opencode', 'messages'],
              predicate: (query) => query.queryKey.includes(sessionID)
            })
          }
          break
        case 'lsp.updated':
          queryClient.invalidateQueries({
            queryKey: ['opencode', 'lsp']
          })
          break
        case 'vcs.branch.updated': {
          const repo = reposRef.current?.find((candidate) => repoMatchesDirectory(candidate, event.directory))
          if (!repo) break

          const branch = event.properties.branch
          if (branch) {
            const updatedRepo = { ...repo, currentBranch: branch, branch }
            queryClient.setQueryData(['repo', repo.id], updatedRepo)
            queryClient.setQueryData<Repo[]>(['repos'], (current) =>
              current?.map((candidate) => candidate.id === repo.id ? updatedRepo : candidate)
            )
          }

          invalidateRepoGitCachesDebounced(queryClient, repo.id)
          break
        }
      }
    }

    const handleStatusChange = (connected: boolean) => {
      if (connected) {
        initialFetchDoneRef.current = false
        fetchInitialPendingData()
      }
    }

    const initialDirectories = [...new Set((reposRef.current ?? []).map(r => r.fullPath))]
    const subscription = openCodeEventStream.subscribeGlobalMonitor({
      directories: initialDirectories,
      onEvent: handleSSEMessage,
      onStatusChange: handleStatusChange,
      onHealthChange: handleHealthChange,
    })
    subscriptionRef.current = subscription
    
    return () => {
      subscription.dispose()
      subscriptionRef.current = null
    }
  }, [addPermission, removePermission, addQuestion, removeQuestion, rememberSessionDirectory, fetchInitialPendingData, queryClient, handleHealthChange])

  useEffect(() => {
    reposRef.current = repos
    const sub = subscriptionRef.current
    if (!sub) return
    const directories = [...new Set((repos ?? []).map(r => r.fullPath))]
    sub.updateDirectories(directories)
  }, [repos])

  useEffect(() => {
    if (!repos || repos.length === 0) return
    if (initialFetchDoneRef.current) return

    initialFetchDoneRef.current = true
    fetchInitialPendingData()
  }, [repos, fetchInitialPendingData])

  const value: EventContextValue = useMemo(() => ({
    sshHostKey: {
      request: sshHostKeyRequest,
      respond: respondToSSHHostKey,
    },
    permissions: {
      current: currentPermission,
      pendingCount: allPermissions.length,
      respond: respondToPermission,
      dismiss: removePermission,
      getForCallID: getPermissionForCallID,
      hasForSession: hasPermissionsForSession,
      showDialog: showPermissionDialog,
      setShowDialog: setShowPermissionDialog,
      navigateToCurrent: navigateToCurrentPermission,
      syncForSession: syncPermissionsForSession,
    },
    questions: {
      current: currentQuestion,
      pendingCount: allQuestions.length,
      reply: replyToQuestion,
      reject: rejectQuestion,
      dismiss: removeQuestion,
      getForCallID: getQuestionForCallID,
      getForSession: getQuestionForSession,
      hasForSession: hasQuestionsForSession,
      navigateToCurrent: navigateToCurrentQuestion,
      syncForSession: syncQuestionsForSession,
    },
    sseHealth,
    getRepoIdForSession,
    getSessionDirectory: findSessionDirectory,
  }), [
    sshHostKeyRequest,
    respondToSSHHostKey,
    currentPermission,
    allPermissions.length,
    respondToPermission,
    removePermission,
    getPermissionForCallID,
    hasPermissionsForSession,
    showPermissionDialog,
    navigateToCurrentPermission,
    syncPermissionsForSession,
    currentQuestion,
    allQuestions.length,
    replyToQuestion,
    rejectQuestion,
    removeQuestion,
    getQuestionForCallID,
    getQuestionForSession,
    hasQuestionsForSession,
    navigateToCurrentQuestion,
    syncQuestionsForSession,
    sseHealth,
    getRepoIdForSession,
    findSessionDirectory,
  ])

  return <EventContext.Provider value={value}>{children}</EventContext.Provider>
}

export function useEventContext() {
  const context = useContext(EventContext)
  if (!context) {
    throw new Error('useEventContext must be used within EventProvider')
  }
  return context
}

export function usePermissions() {
  const { permissions } = useEventContext()
  return permissions
}

export function useQuestions() {
  const { questions } = useEventContext()
  return questions
}

export function useSSEHealth(): SSEHealthState {
  return useEventContext().sseHealth
}
