import { API_BASE_URL } from '@/config'
import { fetchWrapper } from './fetchWrapper'

/**
 * One provider as the tenant stored it.
 *
 * The whole entry, not a summary: the editor reads it back into a form, and a
 * shape that lost fields on the way out would silently drop them on the way
 * back in.
 */
export type DeclaredProviderEntry = Record<string, unknown>

export interface ProviderConflict {
  providerId: string
  globalEntry: unknown
  userEntry: unknown
  /** The tenant has already said they are keeping theirs, for this exact global entry. */
  acknowledged: boolean
}

export interface ProviderDeclarations {
  declarations: Record<string, DeclaredProviderEntry>
  conflicts: ProviderConflict[]
}

const BASE = `${API_BASE_URL}/api/providers/declarations`

export const providerDeclarationsApi = {
  list: async (): Promise<ProviderDeclarations> => {
    return fetchWrapper<ProviderDeclarations>(BASE)
  },

  declare: async (providerId: string, entry: DeclaredProviderEntry): Promise<{ success: boolean }> => {
    return fetchWrapper<{ success: boolean }>(BASE, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ providerId, entry }),
    })
  },

  remove: async (providerId: string): Promise<{ success: boolean }> => {
    return fetchWrapper<{ success: boolean }>(`${BASE}/${encodeURIComponent(providerId)}`, {
      method: 'DELETE',
    })
  },

  /**
   * "I have seen it, and I am keeping mine."
   *
   * Takes no definition. The server records the one it is currently serving for
   * that id, so a client cannot acknowledge a definition it was never shown.
   */
  keepMine: async (providerId: string): Promise<{ success: boolean; acknowledged: boolean }> => {
    return fetchWrapper<{ success: boolean; acknowledged: boolean }>(
      `${BASE}/${encodeURIComponent(providerId)}/keep-mine`,
      { method: 'POST' },
    )
  },
}
