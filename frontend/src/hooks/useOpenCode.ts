import { useQuery, useMutation, useQueryClient, useInfiniteQuery } from "@tanstack/react-query";
import { useMemo, useRef, useEffect, useCallback } from "react";
import { OpenCodeClient } from "../api/opencode";
import { createBffClient } from "../api/bff";
import { FetchError } from "../api/fetchWrapper";
import type {
  Message,
  Part,
  ContentPart,
  MessageWithParts,
} from "../api/types";
import type { paths, components } from "../api/opencode-types";
import { parseNetworkError, isGatewayTimeout } from "../lib/opencode-errors";
import { showToast } from "../lib/toast";
import { useI18n } from "../lib/i18n";
import { useSendErrorStore } from "../stores/sendErrorStore";
import { useSessionStatus } from "../stores/sessionStatusStore";
import { invalidateSessionListCaches, messagesQueryKey, sessionListQueryKey, sessionQuerySession, stopQueries } from "../lib/queryInvalidation";
import { reconcileConfirmedPrompt } from "../lib/sendErrorReconcile";
import { buildSessionKey } from "../lib/sessionKey";
import { toggleSessionPin } from "../api/sessionPins";
import { SESSION_PINS_QUERY_KEY } from "./useSessionPins";
import type { SessionPin } from "@opencode-manager/shared/schemas";

type AssistantMessage = components["schemas"]["AssistantMessage"];

type SendPromptRequest = NonNullable<
  paths["/session/{sessionID}/prompt_async"]["post"]["requestBody"]
>["content"]["application/json"];

type SendCommandResponse = paths["/session/{sessionID}/command"]["post"]["responses"]["200"]["content"]["application/json"];

const parseModelString = (model: string) => {
  const [providerID, ...rest] = model.split("/");
  const modelID = rest.join("/");
  if (!providerID || !modelID) return undefined;
  return { providerID, modelID };
};

export const useOpenCodeClient = (opcodeUrl: string | null | undefined, directory?: string) => {
  return useMemo(
    () => (opcodeUrl ? new OpenCodeClient(opcodeUrl, directory) : null),
    [opcodeUrl, directory],
  );
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
 * This one still asks the agent, and it is the last thing on this surface
 * that does: the detail of a conversation and the event stream about it are
 * filed in the same cache slot, and the event stream still speaks the
 * agent's own dialect. A conversation read in the versioned dialect and then
 * overwritten by one in the agent's would leave the app holding two shapes
 * for the same thing - so the detail moves when the event stream does, and
 * not before.
 */
export const useSession = (opcodeUrl: string | null | undefined, sessionID: string | undefined, directory?: string) => {
  const client = useOpenCodeClient(opcodeUrl, directory);

  return useQuery({
    queryKey: ["opencode", "session", opcodeUrl, sessionID, directory],
    queryFn: () => {
      if (!client || !sessionID) throw new Error('Missing client or sessionID')
      return client.getSession(sessionID)
    },
    enabled: !!client && !!sessionID,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    staleTime: 15000,
    retry: (failureCount) => failureCount < 4,
    retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 8000),
  });
};

export const useMessages = (opcodeUrl: string | null | undefined, sessionID: string | undefined, directory?: string, opts?: { fallbackPoll?: boolean }) => {
  const client = useOpenCodeClient(opcodeUrl, directory);

  return useQuery({
    queryKey: messagesQueryKey(opcodeUrl, sessionID, directory),
    queryFn: async () => {
      if (!client || !sessionID) throw new Error('Missing client or sessionID')
      const response = await client.listMessages(sessionID)
      reconcileConfirmedPrompt(sessionID, response as MessageWithParts[])
      return response as MessageWithParts[]
    },
    enabled: !!client && !!sessionID,
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

const createOptimisticUserMessageParts = (
  sessionID: string,
  parts: ContentPart[],
  optimisticID: string,
) => {
  return parts.map((part, index): Part => {
    if (part.type === "text") {
      return {
        id: `${optimisticID}_part_${index}`,
        type: "text" as const,
        text: part.content,
        messageID: optimisticID,
        sessionID,
      } as Part;
    } else if (part.type === "image") {
      return {
        id: `${optimisticID}_part_${index}`,
        type: "file" as const,
        filename: part.filename,
        url: part.dataUrl,
        mime: part.mime || "image/*",
        messageID: optimisticID,
        sessionID,
      } as Part;
    } else {
      return {
        id: `${optimisticID}_part_${index}`,
        type: "file" as const,
        filename: part.name,
        url: part.path.startsWith("file:") ? part.path : `file://${part.path}`,
        mime: "text/plain",
        messageID: optimisticID,
        sessionID,
      } as Part;
    }
  });
};

const createOptimisticUserMessageInfo = (
  sessionID: string,
  optimisticID: string,
  model?: string,
  agent?: string,
  variant?: string,
): Message => {
  const message = {
    id: optimisticID,
    role: "user",
    sessionID,
    time: { created: Date.now() },
  } as Message;

  if (model) {
    const parsedModel = parseModelString(model);
    if (parsedModel) {
      return {
        ...message,
        model: parsedModel,
        agent,
        variant,
      } as Message;
    }
  }

  return { ...message, agent, variant } as Message;
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

export const useSendPrompt = (opcodeUrl: string | null | undefined, directory?: string) => {
  const client = useOpenCodeClient(opcodeUrl, directory);
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
      if (!client) throw new Error("No client available");

      const queryKey = messagesQueryKey(opcodeUrl, sessionID, directory);
      await stopQueries(queryClient, { queryKey });

      useSessionStatus.getState().setOptimisticActive(sessionID);

      const requestData: SendPromptRequest = {
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

          requestData.model = {
            providerID: parsedModel.providerID,
            modelID: parsedModel.modelID,
          };
        }
      }

      if (agent) {
        requestData.agent = agent;
      }

      if (variant) {
        requestData.variant = variant;
      }

      useSendErrorStore.getState().setQueuedPrompt(sessionID, getPromptText(prompt, parts));
      await client.sendPromptAsync(sessionID, requestData);
    },
    onError: (error, variables) => {
      const { sessionID, prompt, parts } = variables;
      const queryKey = messagesQueryKey(opcodeUrl, sessionID, directory);

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
      const queryKey = messagesQueryKey(opcodeUrl, sessionID, directory);

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
 * The layer is asked, not the agent. The messages are still the agent's own
 * - the event stream has not learned the versioned dialect yet - so the
 * message cache is still filed under the agent's address.
 */
export const useAbortSession = (
  serverUrl: string | null | undefined,
  opcodeUrl: string | null | undefined,
  directory?: string,
  sessionID?: string,
) => {
  const queryClient = useQueryClient();
  const retryIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const retryCountRef = useRef(0);

  const forceCompleteMessages = useCallback((targetSessionID: string) => {
    const queryKey = messagesQueryKey(opcodeUrl, targetSessionID, directory);
    const now = Date.now();
    
    queryClient.setQueryData<MessageWithParts[]>(queryKey, (old) => {
      if (!old) return old;
      
      return old.map(msgWithParts => {
        const msg = msgWithParts.info;
        let updatedParts = msgWithParts.parts;
        
        if (msg.role === "assistant") {
          const assistantInfo = msg as AssistantMessage;
          if (!assistantInfo.time.completed) {
            updatedParts = updatedParts.map(part => {
              if (part.type !== "tool") return part;
              if (part.state.status !== "running" && part.state.status !== "pending") return part;
              return {
                ...part,
                state: {
                  ...part.state,
                  status: "completed" as const,
                  output: part.state.status === "running" ? "[Session aborted]" : "[Tool was pending when session aborted]",
                  title: part.state.status === "running" ? (part.state as { title?: string }).title || "" : "",
                  metadata: (part.state as { metadata?: Record<string, unknown> }).metadata || {},
                  time: {
                    start: (part.state as { time?: { start: number } }).time?.start || now,
                    end: now
                  }
                }
              };
            });
            
            return {
              ...msgWithParts,
              info: {
                ...assistantInfo,
                time: {
                  ...assistantInfo.time,
                  completed: now
                },
                error: {
                  name: "MessageAbortedError" as const,
                  data: { message: "Session aborted" }
                }
              },
              parts: updatedParts
            };
          }
        }
        return msgWithParts;
      });
    });
  }, [queryClient, opcodeUrl, directory]);

  const stopRetrying = useCallback(() => {
    if (retryIntervalRef.current) {
      clearInterval(retryIntervalRef.current);
      retryIntervalRef.current = null;
    }
    retryCountRef.current = 0;
  }, []);

  const isSessionComplete = useCallback((targetSessionID: string) => {
    const queryKey = messagesQueryKey(opcodeUrl, targetSessionID, directory);
    const messages = queryClient.getQueryData<MessageWithParts[]>(queryKey);
    
    const hasIncompleteMessages = messages?.some(msgWithParts => {
      if (msgWithParts.info.role !== "assistant") return false;
      const assistantInfo = msgWithParts.info as AssistantMessage;
      return !assistantInfo.time.completed;
    });

    return !hasIncompleteMessages;
  }, [queryClient, opcodeUrl, directory]);

  useEffect(() => {
    if (!sessionID) return;

    const unsubscribe = queryClient.getQueryCache().subscribe((event) => {
      const queryKey = messagesQueryKey(opcodeUrl, sessionID, directory);
      if (event.query.queryKey.join(",") === queryKey.join(",")) {
        if (isSessionComplete(sessionID) && retryIntervalRef.current) {
          stopRetrying();
        }
      }
    });

    return () => unsubscribe();
  }, [sessionID, queryClient, opcodeUrl, directory, isSessionComplete, stopRetrying]);

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

export const useSendShell = (opcodeUrl: string | null | undefined, directory?: string) => {
  const client = useOpenCodeClient(opcodeUrl, directory);
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
      if (!client) throw new Error("No client available");

      const optimisticUserID = `optimistic_user_${Date.now()}_${Math.random()}`;

      const userMessageParts = createOptimisticUserMessageParts(
        sessionID,
        [{ type: "text" as const, content: command }],
        optimisticUserID,
      );
      const userMessageInfo = createOptimisticUserMessageInfo(sessionID, optimisticUserID);

      const queryKey = messagesQueryKey(opcodeUrl, sessionID, directory);
      await stopQueries(queryClient, { queryKey });

      const optimisticMessageWithParts: MessageWithParts = {
        info: userMessageInfo,
        parts: userMessageParts,
      }
      queryClient.setQueryData<MessageWithParts[]>(
        queryKey,
        (old) => [...(old || []), optimisticMessageWithParts],
      );

      const response = await client.sendShell(sessionID, {
        command,
        agent: agent || "general",
      });

      return { optimisticUserID, response };
    },
    onError: (_, variables) => {
      const { sessionID } = variables;
      queryClient.setQueryData<MessageWithParts[]>(
        messagesQueryKey(opcodeUrl, sessionID, directory),
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
        messagesQueryKey(opcodeUrl, sessionID, directory),
        (old) => {
          if (!old) return old;
          return old.filter((msgWithParts) => msgWithParts.info.id !== optimisticUserID);
        },
      );

      queryClient.invalidateQueries({
        queryKey: ["opencode", "session", opcodeUrl, sessionID, directory],
      });
    },
  });
};

export const useConfig = (opcodeUrl: string | null | undefined, directory?: string) => {
  const client = useOpenCodeClient(opcodeUrl, directory);

  return useQuery({
    queryKey: ["opencode", "config", opcodeUrl, directory],
    queryFn: () => {
      if (!client) throw new Error('Missing client')
      return client.getConfig()
    },
    enabled: !!client,
    staleTime: 60000,
    refetchOnWindowFocus: true,
  });
};

export const useAgents = (opcodeUrl: string | null | undefined, directory?: string) => {
  const client = useOpenCodeClient(opcodeUrl, directory);

  return useQuery({
    queryKey: ["opencode", "agents", opcodeUrl, directory],
    queryFn: () => {
      if (!client) throw new Error('Missing client')
      return client.listAgents()
    },
    enabled: !!client,
  });
};

export const useLoadSkill = (
  opcodeUrl: string | null | undefined,
  sessionID: string | undefined,
  directory?: string,
) => {
  const client = useOpenCodeClient(opcodeUrl, directory);
  const queryClient = useQueryClient();

  return useMutation<
    { optimisticUserID: string; response: SendCommandResponse },
    Error,
    { skillName: string }
  >({
    mutationFn: async ({ skillName }: { skillName: string }) => {
      if (!client) throw new Error("No OpenCode client available");
      if (!sessionID) throw new Error("No active session");

      const optimisticUserID = `optimistic_user_${Date.now()}_${Math.random()}`;
      const queryKey = messagesQueryKey(opcodeUrl, sessionID, directory);

      const userMessageParts = createOptimisticUserMessageParts(
        sessionID,
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

      const response = await client.sendCommand(sessionID, { command: skillName, arguments: "" });
      return { optimisticUserID, response };
    },
    onError: (error) => {
      if (sessionID) {
        const queryKey = messagesQueryKey(opcodeUrl, sessionID, directory);
        queryClient.setQueryData<MessageWithParts[]>(
          queryKey,
          (old) => old?.filter((m) => !m.info.id.startsWith("optimistic_")),
        );
      }
      showToast.error(error instanceof Error ? error.message : "Failed to load skill");
    },
    onSuccess: (data) => {
      const { response } = data;
      const queryKey = messagesQueryKey(opcodeUrl, sessionID, directory);

      queryClient.setQueryData<MessageWithParts[]>(
        queryKey,
        (old) => {
          if (!old) return old;

          const existingIdx = old.findIndex(m => m.info.id === response.info.id);
          if (existingIdx >= 0) {
            const updated = [...old];
            updated[existingIdx] = { info: response.info, parts: response.parts };
            return updated;
          }

          return [...old, { info: response.info, parts: response.parts }];
        },
      );
    },
  });
};
