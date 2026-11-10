import { spawnSync } from 'child_process'
import { existsSync } from 'fs'
import { join } from 'path'

/**
 * Git for Windows ships a bash next to git itself. Its install root is the
 * directory the exec path hangs off, three levels up from `git-core`.
 */
function gitBashPath(): string | null {
  const execPath = spawnSync('git', ['--exec-path'], { encoding: 'utf-8' }).stdout?.trim()
  if (!execPath) return null
  const parts = execPath.split(/[\\/]/).filter(Boolean)
  if (parts.length < 4) return null
  const root = parts.slice(0, parts.length - 3).join('/')
  const bash = join(root, 'bin', 'bash.exe')
  return existsSync(bash) ? bash : null
}

/**
 * The bash a test runs under has to be a shell that can see the host
 * filesystem: the scripts it runs and the fixtures it works on live in host
 * paths.
 *
 * `bash` on the PATH is often not that shell. `C:\Windows\System32\bash.exe`
 * ships with Windows and is the WSL launcher - a real Linux shell in a
 * different filesystem, which cannot `cd` into a host path at all and hands
 * the script's arguments back in a different order. Git for Windows carries
 * its own bash, and that one can.
 *
 * So the candidates are tried in order, and each one has to prove it can
 * reach the directory before it is used. `OCM_TEST_BASH` overrides the list
 * for a machine that keeps its bash somewhere else.
 */
export function resolveHostBash(probeTarget: string): string | null {
  const candidates = [
    process.env.OCM_TEST_BASH,
    'bash',
    gitBashPath(),
  ].filter((candidate): candidate is string => Boolean(candidate))

  for (const candidate of candidates) {
    const probe = spawnSync(candidate, ['-c', 'cd "$1" && pwd', '--', probeTarget], { encoding: 'utf-8' })
    if (probe.status === 0 && (probe.stdout ?? '').trim().length > 0) return candidate
  }
  return null
}
