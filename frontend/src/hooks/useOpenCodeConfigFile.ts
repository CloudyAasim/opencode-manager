import { useQuery } from '@tanstack/react-query'
import { configApi } from '@/api/config'
import type { OpenCodeConfigFile } from '@/api/types/settings'

export const OPEN_CODE_CONFIG_QUERY_KEY = ['opencode-config', 'file'] as const

/**
 * The configuration the agent runs with.
 *
 * Asked for at the layer the client talks to, and not at the manager's own
 * door: the document holds the credentials of every model provider on the
 * host, and a door that answers with it hands the browser the keys.
 */
export function useOpenCodeConfigFile(enabled = true) {
  return useQuery<OpenCodeConfigFile>({
    queryKey: OPEN_CODE_CONFIG_QUERY_KEY,
    queryFn: () => configApi.getConfiguration(),
    enabled,
  })
}
