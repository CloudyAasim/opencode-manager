import { useQuery } from '@tanstack/react-query'
import { useOpenCodeClient } from './useOpenCode'

interface UseLSPStatusOptions {
  enabled?: boolean
}

export function useLSPStatus(
  opcodeUrl: string | null | undefined,
  directory?: string,
  { enabled = true }: UseLSPStatusOptions = {},
) {
  const client = useOpenCodeClient(opcodeUrl, directory)

  return useQuery({
    queryKey: ['opencode', 'lsp', opcodeUrl, directory],
    queryFn: () => {
      if (!client) throw new Error('Missing client')
      return client.getLSPStatus()
    },
    enabled: !!client && enabled,
    refetchInterval: 60000,
    staleTime: 10000,
    refetchOnWindowFocus: true,
  })
}
