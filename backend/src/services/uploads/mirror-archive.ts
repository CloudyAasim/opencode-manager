import { spawn } from 'child_process'
import { mkdtempSync, writeFileSync } from 'fs'
import * as fsp from 'fs/promises'
import { join } from 'path'
import { gitOut } from '../git/git-commands'
import { mkdirSyncSafe } from '../../utils/fs-safe'
import { swallow } from '../../utils/swallow'
import { getStagingRoot } from './mirror-staging'

const HARDCODED_EXCLUDES = ['node_modules', 'dist', '.next', '.venv', '__pycache__', '.turbo']

export async function createMirrorTarStream(
  fullPath: string,
  compress: boolean
): Promise<ReadableStream<Uint8Array>> {
  const excludeArgs: string[] = []
  for (const dir of HARDCODED_EXCLUDES) {
    excludeArgs.push('--exclude', dir)
  }

  let ignoreFile: string | undefined
  try {
    const ignored = await gitOut(fullPath, ['ls-files', '--others', '--ignored', '--exclude-standard', '--directory'])
    if (ignored.trim()) {
      const excludeParent = getStagingRoot()
      mkdirSyncSafe(excludeParent)
      ignoreFile = mkdtempSync(join(excludeParent, 'exclude-'))
      writeFileSync(join(ignoreFile, '.gitignore'), ignored)
      excludeArgs.push('--exclude-from', join(ignoreFile, '.gitignore'))
    }
  } catch {
    void 0
  }

  const tarArgs = ['-c', '-C', fullPath, ...excludeArgs, '.']
  if (compress) {
    tarArgs.unshift('-z')
  }

  const child = spawn('tar', tarArgs, { stdio: ['pipe', 'pipe', 'pipe'] })

  return new ReadableStream({
    start(controller) {
      child.stdout.on('data', (chunk: Buffer) => {
        controller.enqueue(new Uint8Array(chunk))
      })
      child.stdout.on('end', () => {
        controller.close()
        if (ignoreFile) {
          fsp.rm(ignoreFile, { recursive: true, force: true }).catch(swallow)
        }
      })
      child.stdout.on('error', (err: Error) => {
        controller.error(err)
        if (ignoreFile) {
          fsp.rm(ignoreFile, { recursive: true, force: true }).catch(swallow)
        }
      })
    },
  })
}
