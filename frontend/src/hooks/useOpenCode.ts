import { useQuery, useMutation, useQueryClient, useInfiniteQuery } from "@tanstack/react-query";
import { useMemo, useRef, useEffect, useCallback } from "react";
import { createBffClient } from "../api/bff";
import { FetchError } from "../api/fetchWrapper";
import type {
  Message,
  Part,
  ContentPart,
  MessageWithParts,
} from "../api/types";
import type { SendPromptRequest } from "@opencode-manager/shared/api/v1";
import { parseNetworkError, isGatewayTimeout } from "../lib/opencode-errors";
import { showToast } from "../lib/toast";
import { useI18n } from "../lib/i18n";
import { useSendErrorStore } from "../stores/sendErrorStore";
import { useSessionStatus } from "../stores/sessionStatusStore";
import { invalidateSessionListCaches, messagesQueryKey, sessionListQueryKey, sessionQueryKey, sessionQuerySession, stopQueries } from "../lib/queryInvalidation";
import { reconcileConfirmedPrompt } from "../lib/sendErrorReconcile";
import { buildSessionKey } from "../lib/sessionKey";
import { toggleSessionPin } from "../api/sessionPins";
import { SESSION_PINS_QUERY_KEY } from "./useSessionPins";
import type { SessionPin } from "@opencode-manager/shared/schemas";

const parseModelString = (model: string) => {
  const [providerID, ...rest] = model.split("/");
  const modelID = rest.join("/");
  if (!providerID || !modelID) return undefined;
  return { providerID, modelID };
};

const SESSION_LIST_PAGE_SIZE = 25

interface UseSessionsAcrossDirectoriesOptions {
  search?: string
  limit?: number
}

type SessionPageParam = Record<string, string>

/**
 * The sessions of every working directory, in one answer.
 *
 * The client used to ask the agent for one page per directory and merge the
 * answers itself, keeping a cursor per directory so it could ask for the next
 * page of each in turn. That is a server's job: it moved to the layer the
 * client talks to, and what comes back is one list with one cursor per
 * directory in it.
 */
export const useSessionsAcrossDirectories = (
  serverUrl: string | null | undefined,
  directories: string[],
  options?: UseSessionsAcrossDirectoriesOptions,
) => {
  const uniqueDirectories = useMemo(
    () => Array.from(new Set(directories.filter(Boolean))),
    [directories],
  );
  const normalizedSearch = options?.search?.trim() || undefined;
  const limit = options?.limit ?? SESSION_LIST_PAGE_SIZE;
  const directoryKey = uniqueDirectories.join('|');

  const query = useInfiniteQuery({
    queryKey: sessionListQueryKey(serverUrl, directoryKey, { search: normalizedSearch, limit }),
    queryFn: async ({ pageParam }) => {
      const page = await createBffClient(serverUrl!).listSessions(uniqueDirectories, {
        limit,
        search: normalizedSearch,
        cursors: pageParam,
      });
      return { items: page.sessions, cursors: page.cursors };
    },
    initialPageParam: undefined as SessionPageParam | undefined,
    getNextPageParam: (lastPage) => {
      if (Object.keys(lastPage.cursors).length > 0) {
        return lastPage.cursors;
      }
      return undefined;
    },
    // An empty address is not a missing one: it means "the server that served
    // this page". Disabling the list for it would leave the list empty on
    // every deployment that sits behind its own address.
    enabled: serverUrl !== undefined && serverUrl !== null && uniqueDirectories.length > 0,
    staleTime: 10000,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
  });

  return {
    data: query.data?.pages.flatMap((page) => page.items) ?? [],
    isLoading: query.isLoading,
    isFetched: query.isFetched,
    isError: query.isError,
    fetchNextPage: query.fetchNextPage,
    hasNextPage: query.hasNextPage,
    isFetchingNextPage: query.isFetchingNextPage,
    isFetchNextPageError: query.isFetchNextPageError,
    error: query.error,
  };
};

/**
 * One conversation.
 *
 * The layer is asked, not the agent: the layer knows where the conversation
 * lives, and it knows whether the caller may have it. The detail of a
 * conversation and the event stream about it are filed in the same cache slot,
 * and both are in the versioned dialect now - so the app holds one shape for
 * a conversation and not two.
 */
export const useSession = (serverUrl: string | null | undefined, sessionID: string | undefined, directory?: string) => {
  return useQuery({
    queryKey: sessionQueryKey(serverUrl, sessionID, directory),
    queryFn: async () => {
      if (serverUrl === undefined || serverUrl === null) throw new Error('The layer the client talks to is not available')
      if (!sessionID) throw new Error('Missing sessionID')
      const response = await createBffClient(serverUrl).getSession(sessionID, directory ? [directory] : [])
      return response.session
    },
    enabled: serverUrl !== undefined && serverUrl !== null && !!sessionID,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    staleTime: 15000,
    // A conversation that is not the caller's is an answer, not a hiccup:
    // asking again would only be told the same thing.
    retry: (failureCount, error) => !(error instanceof FetchError && error.statusCode === 404) && failureCount < 4,
    retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 8000),
  });
};

/**
 * What was said in one conversation.
 *
 * The layer is asked, not the agent: the client no longer has to know which
 * agent is behind the conversation or which working directory it lives in.
 */
export const useMessages = (serverUrl: string | null | undefined, sessionID: string | undefined, directory?: string, opts?: { fallbackPoll?: boolean }) => {
  return useQuery({
    queryKey: messagesQueryKey(serverUrl, sessionID, directory),
    queryFn: async () => {
      if (serverUrl === undefined || serverUrl === null) throw new Error('The layer the client talks to is not available')
      if (!sessionID) throw new Error('Missing sessionID')
      const response = await createBffClient(serverUrl).listMessages(sessionID, directory ? [directory] : [])
      reconcileConfirmedPrompt(sessionID, response.messages)
      return response.messages
    },
    enabled: serverUrl !== undefined && serverUrl !== null && !!sessionID,
    refetchOnWindowFocus: false,
    refetchOnReconnect: true,
    staleTime: 30000,
    gcTime: 10 * 60 * 1000,
    refetchInterval: opts?.fallbackPoll ? 15000 : undefined,
    retry: (failureCount, error) => !(error instanceof FetchError && error.statusCode === 404) && failureCount < 3,
  });
};

/**
 * A new conversation.
 *
 * The client used to ask the agent for this itself, and the agent's own
 * endpoint takes nothing but a title - so the agent and the model the
 * browser sent along were never read by anything. The layer takes a title
 * and a working directory, and it writes down who asked for it in the same
 * moment the conversation comes into existence.
 */
export const useCreateSession = (
  serverUrl: string | null | undefined,
  directory?: string,
  onSuccess?: (session: { id: string }) => void,
) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: { title?: string }) => {
      if (serverUrl === undefined || serverUrl === null) throw new Error("The layer the client talks to is not available");
      if (!directory) throw new Error("No working directory to create the conversation in");
      const response = await createBffClient(serverUrl).createSession({
        title: data.title,
        directory,
      });
      return response.session;
    },
    onSuccess: (session) => {
      invalidateSessionListCaches(queryClient);
      onSuccess?.(session);
    },
    onError: (error) => {
      const parsed = parseNetworkError(error);
      showToast.error(parsed.title, {
        description: parsed.message,
        duration: 5000,
      });
    },
  });
};

export type DeleteSessionTarget = string | { id: string; directory?: string };

const getDeleteSessionTargetId = (target: DeleteSessionTarget) =>
  typeof target === 'string' ? target : target.id;

const getDeleteSessionTargetDirectory = (target: DeleteSessionTarget, fallbackDirectory?: string) =>
  typeof target === 'string' ? fallbackDirectory : target.directory ?? fallbackDirectory;

const getDeleteSessionTargetKey = (target: DeleteSessionTarget, fallbackDirectory?: string) =>
  buildSessionKey(getDeleteSessionTargetDirectory(target, fallbackDirectory), getDeleteSessionTargetId(target));

/**
 * Conversations, gone.
 *
 * One request per conversation, and the layer works out where each one
 * lives. The working area an agent files a conversation in is the agent's
 * own business: when the area is already gone the area is what has to go
 * instead, and that is the layer's problem now rather than the browser's.
 *
 * The working directory is only a fallback - for a conversation that does not
 * say where it is, and for a target that names no directory of its own.
 */
export const useDeleteSession = (
  serverUrl: string | null | undefined,
  fallbackDirectory?: string,
) => {
  const queryClient = useQueryClient();
  const { t } = useI18n();

  return useMutation({
    mutationFn: async (sessionIDs: DeleteSessionTarget | DeleteSessionTarget[]) => {
      if (serverUrl === undefined || serverUrl === null) {
        throw new Error("The layer the client talks to is not available");
      }

      const targets = Array.from(
        new Map(
          (Array.isArray(sessionIDs) ? sessionIDs : [sessionIDs]).map((target) => [
            getDeleteSessionTargetKey(target, fallbackDirectory),
            target,
          ]),
        ).values(),
      )

      const results: PromiseSettledResult<void>[] = []
      for (const target of targets) {
        const directory = getDeleteSessionTargetDirectory(target, fallbackDirectory)
        try {
          await createBffClient(serverUrl).deleteSession(
            getDeleteSessionTargetId(target),
            directory ? [directory] : [],
          );
          results.push({ status: 'fulfilled', value: undefined });
        } catch (reason) {
          results.push({ status: 'rejected', reason });
        }
      }
      const failures = results.filter(result => result.status === 'rejected')

      if (failures.length > 0) {
        throw new Error(`Failed to delete ${failures.length} session(s)`)
      }

      return { deleted: targets.length, results }
    },
    onSuccess: ({ deleted }) => {
      showToast.success(deleted === 1 ? 'Session deleted' : `${deleted} sessions deleted`);
    },
    onError: () => {
      showToast.error(t('session.actions.deleteFailed'));
    },
    onSettled: (_data, _error, variables) => {
      invalidateSessionListCaches(queryClient);
      cleanupSessionPins(queryClient, variables, fallbackDirectory);
    },
  });
};

const cleanupSessionPins = (
  queryClient: ReturnType<typeof useQueryClient>,
  variables: DeleteSessionTarget | DeleteSessionTarget[],
  primaryDirectory?: string,
) => {
  const pins = queryClient.getQueryData<SessionPin[]>(SESSION_PINS_QUERY_KEY) ?? [];
  if (pins.length === 0) return;
  const pinnedKeys = new Set(pins.map((p) => buildSessionKey(p.directory, p.sessionId)));
  const targets = (Array.isArray(variables) ? variables : [variables])
    .map((target) => ({
      sessionId: getDeleteSessionTargetId(target),
      directory: getDeleteSessionTargetDirectory(target, primaryDirectory) ?? '',
    }))
    .filter((target) => pinnedKeys.has(buildSessionKey(target.directory, target.sessionId)));
  if (targets.length === 0) return;
  void Promise.allSettled(
    targets.map((target) => toggleSessionPin({ ...target, pinned: false })),
  ).then(() => {
    void queryClient.invalidateQueries({ queryKey: SESSION_PINS_QUERY_KEY });
  });
};

/**
 * A conversation's new title.
 *
 * The layer is asked, not the agent: it knows where the conversation lives,
 * so the client does not have to say.
 */
export const useUpdateSession = (serverUrl: string | null | undefined) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ sessionID, title }: { sessionID: string; title: string }) => {
      if (serverUrl === undefined || serverUrl === null) throw new Error("The layer the client talks to is not available");
      const response = await createBffClient(serverUrl).renameSession(sessionID, title);
      return response.session;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        predicate: (query) => sessionQuerySession(query.queryKey) === variables.sessionID,
      });
      invalidateSessionListCaches(queryClient);
    },
  });
};

/**
 * The pieces of a message that has not happened yet.
 *
 * They are the versioned API's pieces, so that a message the app made up and
 * a message the agent sent are the same kind of thing - and so that the
 * moment the agent's own message arrives, it can take the place of the made-up
 * one without anything having to be translated on the way.
 */
const createOptimisticUserMessageParts = (
  parts: ContentPart[],
  optimisticID: string,
): Part[] => {
  return parts.map((part, index): Part => {
    if (part.type === "text") {
      return {
        id: `${optimisticID}_part_${index}`,
        type: "text",
        text: part.content,
        synthetic: null,
        time: null,
      };
    }
    if (part.type === "image") {
      return {
        id: `${optimisticID}_part_${index}`,
        type: "file",
        filename: part.filename,
        url: part.dataUrl,
        mime: part.mime || "image/*",
      };
    }
    return {
      id: `${optimisticID}_part_${index}`,
      type: "file",
      filename: part.name,
      url: part.path.startsWith("file:") ? part.path : `file://${part.path}`,
      mime: "text/plain",
    };
  });
};

const createOptimisticUserMessageInfo = (
  sessionID: string,
  optimisticID: string,
  model?: string,
  agent?: string,
  variant?: string,
): Message => {
  const parsedModel = model ? parseModelString(model) : undefined;
  return {
    id: optimisticID,
    role: "user",
    sessionId: sessionID,
    createdAt: Date.now(),
    completedAt: null,
    cost: null,
    tokens: null,
    modelId: parsedModel?.modelID ?? null,
    providerId: parsedModel?.providerID ?? null,
    agent: agent ?? null,
    variant: variant ?? null,
    parentId: null,
    error: null,
  };
};

const getPromptText = (prompt: string | undefined, parts: ContentPart[] | undefined): string => {
  if (prompt !== undefined) return prompt;
  if (!parts) return "";
  return parts
    .filter((part): part is ContentPart & { type: "text" } => part.type === "text")
    .map((part) => part.content)
    .join("")
    .trim();
};

/**
 * Saying something to one conversation.
 *
 * The layer is asked, not the agent: the layer knows where the conversation
 * lives, so the client does not have to say. The words, the files that go
 * with them, and the model and the agent that should answer all travel
 * together - so the conversation is answered the way it was asked.
 *
 * The agent's address is still known here for one reason only: the list of
 * models that may be picked is still the agent's, and the check that the
 * picked model is still on that list reads the agent's own cache.
 */
export const useSendPrompt = (serverUrl: string | null | undefined, opcodeUrl: string | null | undefined, directory?: string) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      sessionID,
      prompt,
      parts,
      model,
      agent,
      variant,
    }: {
      sessionID: string;
      prompt?: string;
      parts?: ContentPart[];
      model?: string;
      agent?: string;
      variant?: string;
    }) => {
      if (serverUrl === undefined || serverUrl === null) throw new Error("The layer the client talks to is not available");

      const queryKey = messagesQueryKey(serverUrl, sessionID, directory);
      await stopQueries(queryClient, { queryKey });

      useSessionStatus.getState().setOptimisticActive(sessionID);

      const request: SendPromptRequest = {
        parts: parts?.map((part) =>
          part.type === "text"
            ? { type: "text", text: (part as ContentPart & { type: "text" }).content }
            : part.type === "image"
              ? {
                  type: "file",
                  mime: part.mime,
                  filename: part.filename,
                  url: part.dataUrl,
                }
              : {
                  type: "file",
                  mime: "text/plain",
                  filename: part.name,
                  url: part.path.startsWith("file:")
                    ? part.path
                    : `file://${part.path}`,
                },
        ) || [{ type: "text", text: prompt || "" }],
        model: null,
        agent: agent ?? null,
        variant: variant ?? null,
      };

      if (model) {
        const parsedModel = parseModelString(model);
        if (parsedModel) {
          const cachedProviders = queryClient.getQueryData<{
            providers: Array<{ id: string; models: Record<string, unknown> }>;
          }>(['opencode', 'providers', opcodeUrl, directory]);
          if (cachedProviders?.providers) {
            const provider = cachedProviders.providers.find(
              (p) => p.id === parsedModel.providerID,
            );
            if (!provider || !(parsedModel.modelID in provider.models)) {
              throw new FetchError(
                'Selected model is no longer available. Pick a different model.',
                409,
                'MODEL_UNAVAILABLE',
              );
            }
          }

          request.model = {
            providerId: parsedModel.providerID,
            modelId: parsedModel.modelID,
          };
        }
      }

      useSendErrorStore.getState().setQueuedPrompt(sessionID, getPromptText(prompt, parts));
      await createBffClient(serverUrl).sendPrompt(
        sessionID,
        request,
        directory ? [directory] : [],
      );
    },
    onError: (error, variables) => {
      const { sessionID, prompt, parts } = variables;
      const queryKey = messagesQueryKey(serverUrl, sessionID, directory);

      useSendErrorStore.getState().clearQueuedPrompt(sessionID);

      queryClient.setQueryData<MessageWithParts[]>(
        queryKey,
        (old) => old?.filter((msgWithParts) => !msgWithParts.info.id.startsWith("optimistic_")),
      );

      if (isGatewayTimeout(error)) {
        return;
      }

      useSessionStatus.getState().clearStatus(sessionID);

      const parsed = parseNetworkError(error);
      const failedPrompt = getPromptText(prompt, parts);
      useSendErrorStore.getState().setError({
        sessionID,
        title: parsed.title,
        message: parsed.message,
        detail: error instanceof FetchError ? error.detail : undefined,
        failedPrompt: failedPrompt || undefined,
        kind: 'network',
      });
    },
    onSuccess: async (_data, variables) => {
      const { sessionID } = variables;
      // The conversation is cached under the layer's address, so it is
      // invalidated under that address too. Asking for the agent's address
      // here invalidated a slot nothing was ever filed in, and the
      // conversation was refilled by the event stream alone.
      const queryKey = messagesQueryKey(serverUrl, sessionID, directory);

      useSendErrorStore.getState().clearError(sessionID);
      await queryClient.invalidateQueries({ queryKey });
      // The session itself changed: its updated time and title, and for a
      // session that was empty it now exists at all. The list used to learn
      // that only from the SSE session.updated event, so a session created and
      // then written to could stay invisible - the list is not on screen while
      // you type, and if that event is missed nothing else refetches it.
      invalidateSessionListCaches(queryClient);
    },
  });
};

const ABORT_RETRY_INTERVAL_MS = 3000;
const MAX_ABORT_RETRIES = 10;

/**
 * Stop what a conversation is doing.
 *
 * The layer is asked, not the agent. The messages are the versioned API's
 * now - the event stream learned that dialect in the same round - so the
 * message cache is filed under the layer's address.
 */
export const useAbortSession = (
  serverUrl: string | null | undefined,
  directory?: string,
  sessionID?: string,
) => {
  const queryClient = useQueryClient();
  const retryIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const retryCountRef = useRef(0);

  const forceCompleteMessages = useCallback((targetSessionID: string) => {
    const queryKey = messagesQueryKey(serverUrl, targetSessionID, directory);
    const now = Date.now();

    queryClient.setQueryData<MessageWithParts[]>(queryKey, (old) => {
      if (!old) return old;

      return old.map(msgWithParts => {
        const msg = msgWithParts.info;
        let updatedParts = msgWithParts.parts;

        if (msg.role === "assistant") {
          if (!msg.completedAt) {
            updatedParts = updatedParts.map(part => {
              if (part.type !== "tool") return part;
              if (part.state.status !== "running" && part.state.status !== "pending") return part;
              return {
                ...part,
                state: {
                  ...part.state,
                  status: "completed" as const,
                  output: part.state.status === "running" ? "[Session aborted]" : "[Tool was pending when session aborted]",
                  title: part.state.status === "running" ? part.state.title || "" : "",
                  metadata: part.state.metadata || {},
                  time: {
                    start: part.state.time?.start || now,
                    end: now
                  }
                }
              };
            });

            return {
              ...msgWithParts,
              info: {
                ...msg,
                completedAt: now,
                error: {
                  kind: "aborted" as const,
                  message: "Session aborted",
                  providerId: null,
                  statusCode: null,
                  isRetryable: false,
                }
              },
              parts: updatedParts
            };
          }
        }
        return msgWithParts;
      });
    });
  }, [queryClient, serverUrl, directory]);

  const stopRetrying = useCallback(() => {
    if (retryIntervalRef.current) {
      clearInterval(retryIntervalRef.current);
      retryIntervalRef.current = null;
    }
    retryCountRef.current = 0;
  }, []);

  const isSessionComplete = useCallback((targetSessionID: string) => {
    const queryKey = messagesQueryKey(serverUrl, targetSessionID, directory);
    const messages = queryClient.getQueryData<MessageWithParts[]>(queryKey);

    const hasIncompleteMessages = messages?.some(msgWithParts => {
      if (msgWithParts.info.role !== "assistant") return false;
      return !msgWithParts.info.completedAt;
    });

    return !hasIncompleteMessages;
  }, [queryClient, serverUrl, directory]);

  useEffect(() => {
    if (!sessionID) return;

    const unsubscribe = queryClient.getQueryCache().subscribe((event) => {
      const queryKey = messagesQueryKey(serverUrl, sessionID, directory);
      if (event.query.queryKey.join(",") === queryKey.join(",")) {
        if (isSessionComplete(sessionID) && retryIntervalRef.current) {
          stopRetrying();
        }
      }
    });

    return () => unsubscribe();
  }, [sessionID, queryClient, serverUrl, directory, isSessionComplete, stopRetrying]);

  useEffect(() => {
    return () => stopRetrying();
  }, [stopRetrying]);

  const mutation = useMutation({
    mutationFn: async (targetSessionID: string) => {
      if (serverUrl === undefined || serverUrl === null) throw new Error("The layer the client talks to is not available");

      stopRetrying();
      forceCompleteMessages(targetSessionID);

      const attemptAbort = async () => {
        try {
          await createBffClient(serverUrl).abortSession(
            targetSessionID,
            directory ? [directory] : [],
          );
          stopRetrying();
        } catch {
        void 0
        }
      };

      attemptAbort();

      retryIntervalRef.current = setInterval(() => {
        retryCountRef.current++;
        
        if (retryCountRef.current >= MAX_ABORT_RETRIES) {
          stopRetrying();
          return;
        }

        if (isSessionComplete(targetSessionID)) {
          stopRetrying();
          return;
        }

        attemptAbort();
      }, ABORT_RETRY_INTERVAL_MS);
      
      return targetSessionID;
    },
  });

  return mutation;
};

/**
 * Running a command in the conversation's own shell.
 *
 * The shell belongs to the conversation, so the conversation is named and the
 * layer works out where it lives. What the shell writes is a message in the
 * conversation, so it is read from there - and the cache is filed under the
 * layer's address, so it holds one shape.
 */
export const useSendShell = (serverUrl: string | null | undefined, directory?: string) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      sessionID,
      command,
      agent,
    }: {
      sessionID: string;
      command: string;
      agent?: string;
    }) => {
      if (serverUrl === undefined || serverUrl === null) {
        throw new Error("The layer the client talks to is not available");
      }

      const optimisticUserID = `optimistic_user_${Date.now()}_${Math.random()}`;

      const userMessageParts = createOptimisticUserMessageParts(
        [{ type: "text" as const, content: command }],
        optimisticUserID,
      );
      const userMessageInfo = createOptimisticUserMessageInfo(sessionID, optimisticUserID);

      const queryKey = messagesQueryKey(serverUrl, sessionID, directory);
      await stopQueries(queryClient, { queryKey });

      const optimisticMessageWithParts: MessageWithParts = {
        info: userMessageInfo,
        parts: userMessageParts,
      }
      queryClient.setQueryData<MessageWithParts[]>(
        queryKey,
        (old) => [...(old || []), optimisticMessageWithParts],
      );

      const response = await createBffClient(serverUrl).sendShell(
        sessionID,
        { command, workingMode: agent ?? null },
        directory ? [directory] : [],
      );

      return { optimisticUserID, response };
    },
    onError: (_, variables) => {
      const { sessionID } = variables;
      queryClient.setQueryData<MessageWithParts[]>(
        messagesQueryKey(serverUrl, sessionID, directory),
        (old) => {
          if (!old) return old;
          return old.filter((msgWithParts) => !msgWithParts.info.id.startsWith("optimistic_"));
        },
      );
    },
    onSuccess: (data, variables) => {
      const { sessionID } = variables;
      const { optimisticUserID } = data;

      queryClient.setQueryData<MessageWithParts[]>(
        messagesQueryKey(serverUrl, sessionID, directory),
        (old) => {
          if (!old) return old;
          return old.filter((msgWithParts) => msgWithParts.info.id !== optimisticUserID);
        },
      );

      queryClient.invalidateQueries({
        queryKey: sessionQueryKey(serverUrl, sessionID, directory),
      });
    },
  });
};

/**
 * What the agent does by default.
 *
 * The client used to read the agent's whole configuration for these two
 * things - the model a conversation starts on and the way of working it
 * starts in - which meant holding a shape that is the agent's own, full of
 * fields the client never reads.
 *
 * So the layer answers with the two, and the rest of the configuration stays
 * where it belongs.
 */
export const useAgentDefaults = (serverUrl: string | null | undefined, directory?: string) => {
  return useQuery({
    queryKey: ["bff", "defaults", serverUrl, directory],
    queryFn: async () => {
      if (serverUrl === undefined || serverUrl === null) {
        throw new Error('The layer the client talks to is not available')
      }
      const response = await createBffClient(serverUrl).getDefaults(directory ? [directory] : [])
      return response.defaults
    },
    enabled: serverUrl !== undefined && serverUrl !== null,
    staleTime: 60000,
    refetchOnWindowFocus: true,
  });
};

/**
 * The ways of working a conversation can be had in.
 *
 * The word "agent" is taken by the program that does the work, so the ways of
 * working have a word of their own - and they are asked for through the
 * layer, in the versioned dialect, so the client holds one shape for them
 * whichever agent is behind it.
 */
export const useWorkingModes = (serverUrl: string | null | undefined, directory?: string) => {
  return useQuery({
    queryKey: ["bff", "working-modes", serverUrl, directory],
    queryFn: async () => {
      if (serverUrl === undefined || serverUrl === null) {
        throw new Error('The layer the client talks to is not available')
      }
      const response = await createBffClient(serverUrl).listWorkingModes(directory ? [directory] : [])
      return response.workingModes
    },
    enabled: serverUrl !== undefined && serverUrl !== null,
  });
};

export const useLoadSkill = (
  serverUrl: string | null | undefined,
  sessionID: string | undefined,
  directory?: string,
) => {
  const queryClient = useQueryClient();

  return useMutation<
    { optimisticUserID: string; response: unknown },
    Error,
    { skillName: string }
  >({
    mutationFn: async ({ skillName }: { skillName: string }) => {
      if (serverUrl === undefined || serverUrl === null) {
        throw new Error("The layer the client talks to is not available");
      }
      if (!sessionID) throw new Error("No active session");

      const optimisticUserID = `optimistic_user_${Date.now()}_${Math.random()}`;
      const queryKey = messagesQueryKey(serverUrl, sessionID, directory);

      const userMessageParts = createOptimisticUserMessageParts(
        [{ type: "text" as const, content: `Loading skill: ${skillName}` }],
        optimisticUserID,
      );
      const userMessageInfo = createOptimisticUserMessageInfo(sessionID, optimisticUserID);
      const optimisticMessageWithParts: MessageWithParts = {
        info: userMessageInfo,
        parts: userMessageParts,
      };

      await stopQueries(queryClient, { queryKey });
      queryClient.setQueryData<MessageWithParts[]>(
        queryKey,
        (old) => [...(old || []), optimisticMessageWithParts],
      );

      const response = await createBffClient(serverUrl).sendCommand(
        sessionID,
        { command: skillName, arguments: '', workingMode: null, model: null },
        directory ? [directory] : [],
      );
      return { optimisticUserID, response };
    },
    onError: (error) => {
      if (sessionID) {
        const queryKey = messagesQueryKey(serverUrl, sessionID, directory);
        queryClient.setQueryData<MessageWithParts[]>(
          queryKey,
          (old) => old?.filter((m) => !m.info.id.startsWith("optimistic_")),
        );
      }
      showToast.error(error instanceof Error ? error.message : "Failed to load skill");
    },
    onSuccess: () => {
      // The command's own answer is a message in the conversation, and it is
      // read from there: the cache is refilled from the layer instead, and
      // then it holds one shape.
      if (!sessionID) return;
      queryClient.invalidateQueries({
        queryKey: messagesQueryKey(serverUrl, sessionID, directory),
      });
    },
  });
};
