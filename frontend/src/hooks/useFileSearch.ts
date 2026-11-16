import { useState, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { createBffClient } from '@/api/bff'
import { useCancellableTimer } from './use-cancellable-timer'

export interface FileSearchResult {
  files: string[]
  isLoading: boolean
  error: Error | null
}

/**
 * The files that match a word.
 *
 * The client used to ask the agent about this itself, by building the agent's
 * own path out of the address it had been given for it. So the door it walked
 * through was the agent's, and the answer came back in the agent's words.
 *
 * It asks the layer the client talks to now. The layer asks the agent, and
 * checks first that the working directory being searched is the caller's - a
 * file search without a directory to search is not a search, it is a question
 * about somebody else's files.
 */
export function useFileSearch(
  serverUrl: string | null | undefined,
  query: string,
  enabled: boolean = true,
  directory?: string
): FileSearchResult {
  const [debouncedQuery, setDebouncedQuery] = useState(query)
  const { schedule, cancel } = useCancellableTimer()

  useEffect(() => {
    schedule('debounce', () => setDebouncedQuery(query), 300)
    return () => cancel('debounce')
  }, [query, schedule, cancel])

  const { data, isLoading, error } = useQuery({
    queryKey: ['bff', 'file-search', serverUrl, debouncedQuery, directory],
    queryFn: async () => {
      const response = await createBffClient(serverUrl!).searchFiles(
        debouncedQuery,
        directory ? [directory] : [],
      )
      return response.files ?? []
    },
    enabled:
      enabled &&
      serverUrl !== undefined &&
      serverUrl !== null &&
      !!debouncedQuery &&
      !!directory,
    staleTime: 60000,
  })

  return {
    files: data || [],
    isLoading,
    error: error as Error | null
  }
}
