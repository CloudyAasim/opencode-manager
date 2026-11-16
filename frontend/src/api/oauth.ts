import { API_BASE_URL } from "@/config"
import type {
  OAuthAuthorizeRequest,
  OAuthAuthorizeResponse,
  OAuthCallbackRequest,
  ProviderAuthMethod,
} from '@opencode-manager/shared/schemas'
import { fetchWrapper } from "./fetchWrapper"

// These are the shapes the manager's own doors answer in. They used to be
// borrowed from the agent's generated API description, which described doors
// this client never walks through: the manager validates these requests and
// these answers with its own schemas, so those are the ones the client should
// be written against.
export type { OAuthAuthorizeResponse, OAuthCallbackRequest, ProviderAuthMethod }

export interface ProviderAuthMethods {
  [providerId: string]: ProviderAuthMethod[]
}

export const oauthApi = {
  authorize: async (providerId: string, method: number, inputs?: OAuthAuthorizeRequest['inputs']): Promise<OAuthAuthorizeResponse> =>
    fetchWrapper(`${API_BASE_URL}/api/oauth/${providerId}/oauth/authorize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ method, inputs }),
    }),

  callback: async (providerId: string, request: OAuthCallbackRequest): Promise<boolean> =>
    fetchWrapper(`${API_BASE_URL}/api/oauth/${providerId}/oauth/callback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    }),

  getAuthMethods: async (): Promise<ProviderAuthMethods> => {
    const { providers, ...rest } = await fetchWrapper<{ providers?: ProviderAuthMethods } & ProviderAuthMethods>(
      `${API_BASE_URL}/api/oauth/auth-methods`
    )
    return providers || rest
  },
}
