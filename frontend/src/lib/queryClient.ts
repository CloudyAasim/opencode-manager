import { QueryClient } from '@tanstack/react-query'

/**
 * The client every query in this app is asked through.
 *
 * These numbers are not decoration: they are the world a query lives in. A
 * query that is answered locally - handed data that looks like an answer
 * before anybody asked - is "fresh" for `staleTime`, and a fresh query is
 * not asked again. So a stale time that is comfortable for the app's other
 * questions is enough to stop a question from ever being asked at all.
 *
 * That is not a theory. The command list was answered locally with the
 * built-in commands, and with a stale time of a minute the layer was never
 * asked - in the app and in every deployment that talks to its own origin.
 *
 * It lives in its own file so that the tests can run in the same world the
 * app runs in. A test with a different stale time is a test of a different
 * app, and it will happily pass while the app does the wrong thing.
 */
export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 1000 * 60,
        gcTime: 1000 * 60 * 30,
        refetchOnWindowFocus: false,
        refetchOnReconnect: true,
        retry: 1,
        retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 8000),
      },
      mutations: {
        retry: 0,
      },
    },
  })
}
