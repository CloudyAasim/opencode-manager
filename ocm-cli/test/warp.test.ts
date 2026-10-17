import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { WarpTarget } from '../src/warp.js'
import { setPendingWarp, takePendingWarp, buildAttachArgs, buildAttachEnv, runPendingWarp } from '../src/warp.js'
import { REMOTE_MANAGER_URL_ENV, REMOTE_REPO_NAME_ENV } from '../src/remote-context.js'

const sampleTarget: WarpTarget = {
  managerUrl: 'https://manager.example.com',
  token: 'tok_abc123',
  directory: '/workspace/my-repo',
  sessionID: 'sess_42',
  repoName: 'my-repo',
}

describe('buildAttachArgs', () => {
  it('produces the exact argv array for a sample target', () => {
    const args = buildAttachArgs(sampleTarget)

    expect(args).toEqual([
      'attach',
      'https://manager.example.com/api/opencode-proxy',
      '--dir', '/workspace/my-repo',
      '--session', 'sess_42',
    ])
  })

  /**
   * `/proc/<pid>/cmdline` is mode 0444, so a token on the command line is
   * readable by every user on the machine for as long as the attach runs.
   * `attach --password` documents `OPENCODE_SERVER_PASSWORD` as its default,
   * so the same credential goes in the environment, where
   * `/proc/<pid>/environ` is 0400.
   */
  it('keeps the token out of argv', () => {
    expect(buildAttachArgs(sampleTarget).join(' ')).not.toContain(sampleTarget.token)
  })

  it('supplies the token through the environment opencode reads by default', () => {
    const env = buildAttachEnv(sampleTarget)

    expect(env.OPENCODE_SERVER_PASSWORD).toBe(sampleTarget.token)
    // Its documented default is OPENCODE_SERVER_USERNAME or `opencode`, which is
    // the value the argument carried before.
    expect(env.OPENCODE_SERVER_USERNAME).toBe('opencode')
    expect(env[REMOTE_MANAGER_URL_ENV]).toBe(sampleTarget.managerUrl)
    expect(env[REMOTE_REPO_NAME_ENV]).toBe(sampleTarget.repoName)
  })
})

describe('setPendingWarp / takePendingWarp', () => {
  beforeEach(() => {
    takePendingWarp()
  })

  it('round-trips the target', () => {
    setPendingWarp(sampleTarget)
    expect(takePendingWarp()).toEqual(sampleTarget)
  })

  it('returns undefined on second take', () => {
    setPendingWarp(sampleTarget)
    takePendingWarp()
    expect(takePendingWarp()).toBeUndefined()
  })
})

describe('runPendingWarp', () => {
  beforeEach(() => {
    takePendingWarp()
  })

  it('is a no-op when nothing is pending', () => {
    const spawn = vi.fn()
    runPendingWarp(spawn)
    expect(spawn).not.toHaveBeenCalled()
  })

  it('calls spawn once with the correct args and env', () => {
    const spawn = vi.fn()
    setPendingWarp(sampleTarget)

    runPendingWarp(spawn)

    expect(spawn).toHaveBeenCalledOnce()
    expect(spawn).toHaveBeenCalledWith(
      'opencode',
      buildAttachArgs(sampleTarget),
      {
        stdio: 'inherit',
        env: buildAttachEnv(sampleTarget),
      },
    )
  })

  it('does not spawn again on a second invocation', () => {
    const spawn = vi.fn()
    setPendingWarp(sampleTarget)

    runPendingWarp(spawn)
    runPendingWarp(spawn)

    expect(spawn).toHaveBeenCalledOnce()
  })

  it('swallows a throwing spawn without propagating', () => {
    const spawn = vi.fn(() => { throw new Error('spawn failed') })
    setPendingWarp(sampleTarget)

    expect(() => runPendingWarp(spawn)).not.toThrow()
    expect(spawn).toHaveBeenCalledOnce()
  })
})
describe('runPendingWarp failure reporting', () => {
  beforeEach(() => {
    takePendingWarp()
  })

  function captureStderr(run: () => void): string {
    const original = process.stderr.write
    let captured = ''
    process.stderr.write = ((chunk: string) => {
      captured += chunk
      return true
    }) as typeof process.stderr.write
    try {
      run()
    } finally {
      process.stderr.write = original
    }
    return captured
  }

  it('reports a spawn error that spawnSync returns instead of throwing', () => {
    const spawn = vi.fn().mockReturnValue({ error: new Error('ENOENT: no such file or directory') })
    setPendingWarp(sampleTarget)

    let result: boolean | undefined
    const stderr = captureStderr(() => {
      result = runPendingWarp(spawn)
    })

    expect(result).toBe(false)
    expect(stderr).toContain('could not start opencode')
    expect(stderr).toContain('ENOENT')
  })

  it('reports a thrown spawn error', () => {
    const spawn = vi.fn(() => {
      throw new Error('EACCES')
    })
    setPendingWarp(sampleTarget)

    const stderr = captureStderr(() => {
      expect(runPendingWarp(spawn)).toBe(false)
    })

    expect(stderr).toContain('EACCES')
  })

  it('says nothing when the spawn succeeds', () => {
    const spawn = vi.fn().mockReturnValue({ status: 0 })
    setPendingWarp(sampleTarget)

    let result: boolean | undefined
    const stderr = captureStderr(() => {
      result = runPendingWarp(spawn)
    })

    expect(result).toBe(true)
    expect(stderr).toBe('')
  })
})
