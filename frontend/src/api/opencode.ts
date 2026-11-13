import type { paths } from './opencode-types'
import { fetchWrapper } from './fetchWrapper'

type ConfigResponse = paths['/config']['get']['responses']['200']['content']['application/json']
type CommandListResponse = paths['/command']['get']['responses']['200']['content']['application/json']
type CommandRequest = NonNullable<paths['/session/{sessionID}/command']['post']['requestBody']>['content']['application/json']
type SendCommandResponse = paths['/session/{sessionID}/command']['post']['responses']['200']['content']['application/json']
type ShellRequest = NonNullable<paths['/session/{sessionID}/shell']['post']['requestBody']>['content']['application/json']
type AgentListResponse = paths['/agent']['get']['responses']['200']['content']['application/json']
type LspStatusResponse = paths['/lsp']['get']['responses']['200']['content']['application/json']
type LspStatus = LspStatusResponse[number]

export type { SendCommandResponse, LspStatus }

/**
 * The agent's own door.
 *
 * What is left on it is what has not moved to the layer the client talks to:
 * the settings of the agent, the commands it knows, the agents it can be, the
 * shell it runs in, and the things it is asked to remember about a
 * conversation.
 *
 * The conversation itself is not here any more - it is read from the layer,
 * in the versioned dialect, and the event stream says the same thing in the
 * same words. How the agent is getting on with a conversation is not the
 * shape of a conversation, so that is still here too.
 */
export class OpenCodeClient {
  private baseURL: string
  private directory?: string

  constructor(baseURL: string, directory?: string) {
    this.baseURL = baseURL
    this.directory = directory
  }

  setDirectory(directory: string) {
    this.directory = directory
  }

  private getParams(params?: Record<string, string | number | boolean | undefined>) {
    if (!this.directory) return params
    return { ...params, directory: this.directory }
  }

  async forkSession(sessionID: string, messageID?: string) {
    return fetchWrapper<paths['/session/{sessionID}']['get']['responses']['200']['content']['application/json']>(`${this.baseURL}/session/${sessionID}/fork`, {
      method: 'POST',
      params: this.getParams(),
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messageID }),
    })
  }

  async summarizeSession(sessionID: string, providerID: string, modelID: string) {
    return fetchWrapper(`${this.baseURL}/session/${sessionID}/summarize`, {
      method: 'POST',
      params: this.getParams(),
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ providerID, modelID }),
    })
  }

  async getConfig() {
    return fetchWrapper<ConfigResponse>(`${this.baseURL}/config`, {
      params: this.getParams(),
    })
  }


  async updateConfig(config: Partial<ConfigResponse>) {
    return fetchWrapper<ConfigResponse>(`${this.baseURL}/config`, {
      method: 'PATCH',
      params: this.getParams(),
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(config),
    })
  }

  async getProviders() {
    return fetchWrapper(`${this.baseURL}/provider`, {
      params: this.getParams(),
    })
  }

  async getConfigProviders() {
    return fetchWrapper(`${this.baseURL}/config/providers`, {
      params: this.getParams(),
    })
  }

  async listCommands() {
    return fetchWrapper<CommandListResponse>(`${this.baseURL}/command`, {
      params: this.getParams(),
    })
  }

  async sendCommand(sessionID: string, data: CommandRequest): Promise<SendCommandResponse> {
    return fetchWrapper<SendCommandResponse>(`${this.baseURL}/session/${sessionID}/command`, {
      method: 'POST',
      params: this.getParams(),
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
      timeout: 0,
    })
  }

  async sendShell(sessionID: string, data: ShellRequest) {
    return fetchWrapper(`${this.baseURL}/session/${sessionID}/shell`, {
      method: 'POST',
      params: this.getParams(),
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    })
  }

  /**
   * How the agent is getting on with its conversations.
   *
   * This is not the shape of a conversation - it is the agent's account of
   * its own work, and the event stream still carries it in the agent's own
   * words. So it is still asked of the agent, and it moves when the status
   * moves.
   */
  async getSessionStatuses() {
    return fetchWrapper<Record<string, { type: 'idle' } | { type: 'busy' } | { type: 'retry'; attempt: number; message: string; next: number }>>(`${this.baseURL}/session/status`, {
      params: this.getParams(),
    })
  }

  async respondToPermission(permissionID: string, response: 'once' | 'always' | 'reject') {
    return fetchWrapper(`${this.baseURL}/permission/${permissionID}/reply`, {
      method: 'POST',
      params: this.getParams(),
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reply: response }),
    })
  }

  async replyToQuestion(requestID: string, answers: string[][]) {
    return fetchWrapper(`${this.baseURL}/question/${requestID}/reply`, {
      method: 'POST',
      params: this.getParams(),
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ answers }),
    })
  }

  async rejectQuestion(requestID: string) {
    return fetchWrapper(`${this.baseURL}/question/${requestID}/reject`, {
      method: 'POST',
      params: this.getParams(),
    })
  }

  async listAgents() {
    return fetchWrapper<AgentListResponse>(`${this.baseURL}/agent`, {
      params: this.getParams(),
    })
  }

  getEventSourceURL() {
    const base = this.baseURL.startsWith('http')
      ? this.baseURL
      : `${window.location.origin}${this.baseURL}`
    const url = new URL(`${base}/event`)
    if (this.directory) {
      url.searchParams.set('directory', this.directory)
    }
    return url.toString()
  }
}

export const createOpenCodeClient = (baseURL: string, directory?: string) => {
  return new OpenCodeClient(baseURL, directory)
}
