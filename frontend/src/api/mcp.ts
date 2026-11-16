import { fetchWrapper } from './fetchWrapper'
import { createBffClient } from './bff'
import { API_BASE_URL } from '@/config'
import type { McpServer, McpServerConfig } from '@opencode-manager/shared/api/v1'

/**
 * The tool servers.
 *
 * The client used to ask the agent about these itself: for the state of each
 * server, and for the document the servers are written down in. That document
 * is also where the credentials of every model provider on the host live, so
 * asking for it handed the browser the keys to every model this server can
 * reach.
 *
 * So the client asks the layer it talks to, and what comes back is the
 * servers: their state, and enough of their shape to draw them. The document
 * stays where it was written down.
 */
export type { McpServer, McpServerConfig }

/** What state a server is in. */
export type McpServerState = McpServer['state']

export interface McpAuthStartResponse {
  authorizationUrl: string
  flowId: string
}

export type McpOAuthFlowStatus =
  | { status: 'pending' }
  | { status: 'completed'; serverName: string }
  | { status: 'failed'; error: string }
  | { status: 'unknown' }

function client() {
  return createBffClient(API_BASE_URL)
}

function scopeOf(directory?: string): string[] {
  return directory ? [directory] : []
}

export const mcpApi = {
  /**
   * The servers, and what state each one is in.
   *
   * A working directory is named when the caller has one: the configuration of
   * a project may add servers of its own, and the directory decides whose.
   */
  async listServers(directory?: string): Promise<McpServer[]> {
    const answer = await client().listMcpServers(scopeOf(directory))
    return answer.servers ?? []
  },

  /**
   * Adding a server.
   */
  async addServer(name: string, config: McpServerConfig): Promise<void> {
    await client().addMcpServer(name, config)
  },

  /**
   * Starting a server.
   */
  async connect(name: string, directory?: string): Promise<void> {
    await client().connectMcpServer(name, scopeOf(directory))
  },

  /**
   * Stopping a server.
   */
  async disconnect(name: string, directory?: string): Promise<void> {
    await client().disconnectMcpServer(name, scopeOf(directory))
  },

  /**
   * Asking a server to authorize itself.
   */
  async authenticate(name: string, directory?: string): Promise<void> {
    await client().authenticateMcpServer(name, scopeOf(directory))
  },

  /**
   * Taking the authorization away.
   */
  async removeAuth(name: string, directory?: string): Promise<void> {
    await client().removeMcpAuth(name, scopeOf(directory))
  },

  /**
   * Finishing an authorization.
   *
   * A change lands in a working directory, so the directory it belongs to is
   * named - otherwise it lands in the directory the server itself was started
   * in, which belongs to nobody in particular.
   */
  async completeAuth(name: string, code: string, directory?: string): Promise<void> {
    await client().completeMcpAuth(name, code, scopeOf(directory))
  },

  /**
   * Starting an authorization.
   *
   * This one is not the agent's door: the flow is the manager's own work, and
   * the manager is the one that holds the code and writes the tokens down.
   *
   * The secret that belongs to an OAuth client is not asked for. The person
   * who draws the list of servers has no reason to hold one, and the manager
   * can read it out of the configuration the server was written down in.
   */
  async startAuth(
    name: string,
    serverUrl: string,
    scope?: string,
    clientId?: string,
    directory?: string,
  ): Promise<McpAuthStartResponse> {
    return fetchWrapper<McpAuthStartResponse>(`${API_BASE_URL}/api/mcp-oauth-proxy/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ serverName: name, serverUrl, scope, clientId, directory }),
    })
  },

  async checkFlowStatus(flowId: string): Promise<McpOAuthFlowStatus> {
    try {
      return await fetchWrapper<McpOAuthFlowStatus>(
        `${API_BASE_URL}/api/mcp-oauth-proxy/status/${encodeURIComponent(flowId)}`,
      )
    } catch {
      return { status: 'unknown' }
    }
  },
}
