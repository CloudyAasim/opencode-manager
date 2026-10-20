import { describe, expect, it } from 'vitest'
import { executeCommand } from '../../src/utils/process'

describe('executeCommand signal handling', () => {
  // A child killed by a signal is how POSIX reports a termination; Windows
  // has no signals, and Node reports the same thing as an exit code instead
  // (2304 for a hard kill). The branch under test is the signal one, so it
  // can only be reached here - CI runs this on Linux.
  it.skipIf(process.platform === 'win32')('reports a signal-terminated child as a non-zero exit code when exit codes are ignored', async () => {
    const result = await executeCommand(['sh', '-c', 'kill -KILL $$'], {
      ignoreExitCode: true,
      silent: true,
    })
    const structured = typeof result === 'string' ? { exitCode: 0, stdout: result, stderr: '' } : result

    expect(structured.exitCode).not.toBe(0)
    expect(structured.stderr).toContain('Command terminated by signal SIGKILL')
  })

  it.skipIf(process.platform === 'win32')('rejects a signal-terminated child when exit codes are enforced', async () => {
    await expect(executeCommand(['sh', '-c', 'kill -KILL $$'], { silent: true })).rejects.toThrow(
      'Command failed with signal SIGKILL',
    )
  })

  it('resolves a zero exit code as success when exit codes are ignored', async () => {
    const result = await executeCommand(['sh', '-c', 'true'], { ignoreExitCode: true, silent: true })

    expect(result).toEqual({ exitCode: 0, stdout: '', stderr: '' })
  })
})
