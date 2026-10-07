import type { EventStreamConnection, EventStreamTransport, EventStreamTransportHandlers } from './types'
import { joinServerUrl } from '@opencode-manager/shared/utils'
import { API_BASE_URL } from '@/config'

export function createBrowserEventStreamTransport(): EventStreamTransport {
  return {
    open(url: string, handlers: EventStreamTransportHandlers): EventStreamConnection {
      const eventSource = new EventSource(url, { withCredentials: true })

      eventSource.onopen = handlers.onOpen
      eventSource.onerror = handlers.onError
      eventSource.onmessage = (event) => handlers.onMessage(event.data)
      eventSource.addEventListener('connected', (event) => {
        handlers.onConnected((event as MessageEvent).data)
      })
      eventSource.addEventListener('heartbeat', handlers.onHeartbeat)

      return {
        close: () => eventSource.close(),
      }
    },

    async post(path: string, body: unknown): Promise<boolean> {
      // The four subscribe/unsubscribe/visibility posts all arrive here as bare
      // paths. Resolving them in one place is what stops an installed client
      // from quietly posting to its own origin instead of the chosen server.
      const response = await fetch(joinServerUrl(API_BASE_URL, path), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })

      return response.ok
    },
  }
}