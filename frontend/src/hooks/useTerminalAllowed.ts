import { useQuery } from '@tanstack/react-query'
import { terminalApi } from '@/api/terminal'

export function useTerminalAllowed(): boolean {
  const { data } = useQuery({
    queryKey: ['terminal-config'],
    queryFn: terminalApi.getConfig,
    staleTime: 1000 * 60 * 5,
    retry: false,
  })

  return Boolean(data?.enabled && !data?.adminsOnly)
}
