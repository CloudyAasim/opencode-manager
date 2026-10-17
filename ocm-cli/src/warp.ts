import { spawnSync } from 'node:child_process'
import { buildRemoteAttachEnv } from './remote-context.js'

export type WarpTarget = {
  managerUrl: string
  token: string
  directory: string
  sessionID: string
  repoName: string
}

export type WarpSpawn = (
  command: string,
  args: string[],
  options: { stdio: 'inherit'; env: NodeJS.ProcessEnv },
) => { error?: Error; status?: number | null } | unknown

let pending: WarpTarget | undefined

export function setPendingWarp(target: WarpTarget): void {
  pending = target
}

export function takePendingWarp(): WarpTarget | undefined {
  const t = pending
  pending = undefined
  return t
}

export function buildAttachArgs(target: WarpTarget): string[] {
  return [
    'attach',
    `${target.managerUrl}/api/opencode-proxy`,
    '--dir', target.directory,
    '--session', target.sessionID,
  ]
}

/**
 * The environment the attach runs with, including the credential.
 *
 * The token goes here rather than on the command line. `attach --password`
 * documents `OPENCODE_SERVER_PASSWORD` as its default, so the variable is the
 * same input by another name - and the two are not equally visible:
 * `/proc/<pid>/cmdline` is mode 0444, so an argument is readable by every user
 * on the machine for as long as the attach runs, while `/proc/<pid>/environ`
 * is 0400. Verified against a live process rather than assumed.
 *
 * `--username` goes the same way; its documented default is
 * `OPENCODE_SERVER_USERNAME` or `opencode`, which is the value it carried.
 */
export function buildAttachEnv(target: WarpTarget): NodeJS.ProcessEnv {
  return {
    ...process.env,
    OPENCODE_SERVER_PASSWORD: target.token,
    OPENCODE_SERVER_USERNAME: 'opencode',
    ...buildRemoteAttachEnv(target.managerUrl, target.repoName),
  }
}

/**
 * Attaches to the session the TUI was just asked to hand over to.
 *
 * Runs from `onDispose`, which means the TUI has already gone by the time this
 * executes - so a failure here used to be completely invisible: the terminal
 * simply came back. `spawnSync` does not throw when the child exits badly
 * either; it hands back `{ status, error }`, and that was being discarded
 * along with a bare `catch`.
 *
 * Only the case where `opencode` could not be started at all is reported here.
 * A non-zero exit is not treated as a failure, because what a successful attach
 * exits with is not knowable from here.
 */
export function runPendingWarp(spawn: WarpSpawn = spawnSync): boolean {
  const target = takePendingWarp()
  if (!target) return false

  let failure: string | undefined
  try {
    const result = spawn('opencode', buildAttachArgs(target), {
      stdio: 'inherit',
      env: buildAttachEnv(target),
    }) as { error?: Error } | undefined

    if (result?.error) {
      failure = result.error.message
    }
  } catch (error) {
    failure = error instanceof Error ? error.message : String(error)
  }

  if (failure) {
    process.stderr.write(`ocm: could not start opencode to attach: ${failure}\n`)
    return false
  }
  return true
}