import { spawnSync } from 'child_process'
import path from 'path'

/**
 * GNU tar reads a name that contains a colon as `host:path`, and a Windows
 * path is exactly that: `C:\Users\...` is read as the host `C`, and tar
 * answers "Cannot connect to C: resolve failed". Its own answer is
 * `--force-local`, which tells it to take the name literally.
 *
 * bsdtar - the tar macOS ships, and the one Windows ships - has no such
 * rule and rejects the option outright ("Option --force-local is not
 * supported"), so it must never be passed there. Which of the two is
 * installed is therefore something to ask rather than assume.
 */
let gnuTar: boolean | null = null

export function tarIsGnu(): boolean {
  if (gnuTar === null) {
    const probe = spawnSync('tar', ['--version'], { encoding: 'utf-8' })
    gnuTar = (probe.stdout || '').includes('GNU tar')
  }
  return gnuTar
}

/**
 * The arguments that make a tar invocation treat its file names as local.
 *
 * They go first, and they have to: GNU tar stops reading options at the
 * first operand, so a flag placed after a file name is taken as one.
 */
export function tarLocalArgs(): string[] {
  return tarIsGnu() ? ['--force-local'] : []
}

/**
 * A path, spelled the way tar spells paths.
 *
 * Forward slashes, always. bsdtar takes either, but GNU tar's `--force-local`
 * only stops it reading the drive letter as a host - it still has to open
 * the directory, and it opens a name with backslashes in it as if the
 * backslashes were part of the name ("Cannot open: No such file or
 * directory"). Forward slashes it opens on every platform.
 */
export function tarPath(target: string): string {
  return target.split(path.sep).join('/')
}
