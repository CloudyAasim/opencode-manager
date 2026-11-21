import { createBffClient } from './bff'
import { API_BASE_URL } from '@/config'
import type { OpenCodeConfigFile, OpenCodeConfigSaveResponse } from './types/settings'

/**
 * The configuration the agent runs with.
 *
 * The client used to ask the manager's own door for this, and that door
 * answered with the document as it is written down - which is where the
 * credentials of every model provider on the host live. Four keys went into
 * the browser that way, and the browser had no reason to hold any of them.
 *
 * So the client asks the layer it is supposed to be talking to, and the
 * document comes back with every credential behind a word. What the client
 * may do with it is read it and write it; the keys are not part of that
 * bargain.
 */
function client() {
  return createBffClient(API_BASE_URL)
}

export const configApi = {
  /**
   * The configuration, as it is written down.
   */
  async getConfiguration(): Promise<OpenCodeConfigFile> {
    const answer = await client().getConfiguration()
    return answer.configuration
  },

  /**
   * Writing the configuration.
   *
   * What lands on disk is the client's document with the server's own
   * credentials in it. A client that writes a different value at a credential
   * path is not changing a key; a client that takes the provider away takes
   * the key with it. The places where an edit did not happen are named in the
   * answer.
   */
  async updateConfiguration(request: {
    content: Record<string, unknown> | string
    source?: string
    expectedRevision?: string
  }): Promise<OpenCodeConfigSaveResponse> {
    const answer = await client().updateConfiguration(request)
    return {
      ...answer.configuration,
      restartRequired: answer.restartRequired,
      overriddenCredentials: answer.overriddenCredentials,
    }
  },
}
