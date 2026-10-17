import type { QueryClient } from '@tanstack/react-query'
import type { MessageWithParts, Part } from '@/api/types'

/**
 * Marks a running tool part as errored the moment the user rejects it.
 *
 * Without this the tool sits in `running` until the server gets round to
 * reporting the rejection, so the spinner keeps going after a decision the
 * user has already made.
 *
 * This lives in its own module rather than in `EventContext` so it can be
 * tested: it reaches into the query cache by key position, and the failure mode
 * when that position is wrong is silent - no error, no toast, a tool that spins
 * forever.
 */
export function optimisticallyErrorToolPart(
  queryClient: QueryClient,
  sessionID: string,
  messageID: string,
  callID: string,
  errorMessage: string
) {
  const cache = queryClient.getQueryCache()
  const queries = cache.getAll()

  for (const query of queries) {
    const key = query.queryKey
    // `['opencode', 'messages', <baseUrl>, <sessionID>, <directory>]`. Positional,
    // which is the fragile part - see the note above.
    if (key[0] === 'opencode' && key[1] === 'messages' && key.length >= 5) {
      const querySessionID = key[3] as string
      if (querySessionID !== sessionID) continue

      const currentData = queryClient.getQueryData<MessageWithParts[]>(key)
      if (!currentData) continue

      const updatedData = currentData.map(msgWithParts => {
        if (msgWithParts.info.id !== messageID) return msgWithParts

        const targetPart = msgWithParts.parts.find((p): p is Extract<Part, { type: 'tool' }> & {
          callID: string
          state: Extract<Part, { type: 'tool' }>['state'] & {
            status: 'running'
            input: Record<string, unknown>
            time: { start: number }
          }
        } =>
          p.type === 'tool' &&
          'callID' in p &&
          p.callID === callID &&
          'state' in p &&
          p.state?.status === 'running'
        )
        if (!targetPart) {
          return msgWithParts
        }

        const targetState = targetPart.state
        const targetId = targetPart.id

        const updatedParts = msgWithParts.parts.map(p => {
          if (p.id !== targetId) return p
          if (p.type !== 'tool') return p
          return {
            ...p,
            state: {
              status: 'error' as const,
              input: targetState.input,
              error: errorMessage,
              time: {
                start: targetState.time.start,
                end: Date.now(),
              },
            },
          }
        })

        return {
          ...msgWithParts,
          parts: updatedParts,
        }
      })

      queryClient.setQueryData(key, updatedData)
      break
    }
  }
}
