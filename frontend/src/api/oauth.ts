import { API_BASE_URL } from '@/config'
import type {
  ProviderAuthMethod,
  ProviderOAuthAuthorization,
} from '@opencode-manager/shared/api/v1'
import { createBffClient } from './bff'

/**
 * The ways a provider may be logged in, and the authorizations started with
 * them.
 *
 * The client used to ask the manager's own doors for these, and those doors
 * answered in the manager's older words - and, for the ways themselves, in
 * the agent's: a list of methods the client never checked against anything,
 * and errors that named the agent's own failures.
 *
 * Now it asks the layer, which asks the agent in the agent's own words and
 * hands back this layer's.
 */
export type { ProviderAuthMethod, ProviderOAuthAuthorization }

function client() {
  return createBffClient(API_BASE_URL)
}

export const oauthApi = {
  /**
   * How each provider may be logged in.
   */
  async getAuthMethods(): Promise<Record<string, ProviderAuthMethod[]>> {
    const answer = await client().listProviderAuthMethods()
    return answer.methods ?? {}
  },

  /**
   * Starting an authorization.
   */
  async authorize(
    providerId: string,
    method: number,
    inputs?: Record<string, string>,
  ): Promise<ProviderOAuthAuthorization> {
    const answer = await client().authorizeProviderAuth(providerId, {
      method,
      inputs: inputs ?? null,
    })
    return answer.authorization
  },

  /**
   * Finishing an authorization.
   */
  async callback(
    providerId: string,
    request: { method: number; code?: string },
  ): Promise<void> {
    await client().completeProviderAuth(providerId, {
      method: request.method,
      code: request.code ?? null,
    })
  },
}
