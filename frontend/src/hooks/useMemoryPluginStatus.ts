import { useQuery } from '@tanstack/react-query'
import { settingsApi } from '@/api/settings'

export function useMemoryPluginStatus() {
  const { data } = useQuery({
    queryKey: ['memory-plugin-status'],
    queryFn: () => settingsApi.getMemoryPluginStatus(),
    staleTime: 60000,
  })

  return { memoryPluginEnabled: data?.memoryPluginEnabled ?? false }
}
