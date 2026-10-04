/**
 * Loud, early check that the paths holding user data are actually mounted.
 *
 * The container image sets DATABASE_PATH=/app/data/opencode.db but
 * WORKSPACE_PATH=/workspace, and chat history is not in that database at all:
 * OpenCode is given XDG_DATA_HOME=$WORKSPACE_PATH/.opencode/state, so every
 * conversation lives under /workspace. Under Dokku only /app/data survives an
 * image rebuild - everything else is thrown away with the container's writable
 * layer. With no storage mount in place, every deploy silently takes the
 * repositories and every chat with it.
 *
 * The docs already said "不配会丢数据". This is what stops it from being
 * silent: a bind mount shows up in /proc/self/mountinfo, a directory created
 * by the image does not.
 */

import fs from 'node:fs'

/** One line of /proc/self/mountinfo, e.g.
 *  36 35 98:0 /mnt1 /data rw,noatime master:1 - ext3 /dev/root rw
 *  -> field 4 is the mount point. */
export function parseMountInfo(content: string): Set<string> {
  const mountPoints = new Set<string>()

  for (const line of content.split('\n')) {
    const fields = line.trim().split(/\s+/)
    if (fields.length < 5) continue
    // Only filesystem mounts; skip things like /proc, /sys and cgroup mounts,
    // which are never where user data should live.
    const separator = fields.indexOf('-')
    if (separator < 0 || separator > fields.length - 4) continue
    mountPoints.add(fields[4])
  }

  return mountPoints
}

/**
 * A path is persistent when a mount point other than the container root is it,
 * or an ancestor of it: /data/app.db is covered by a mount on /data.
 *
 * The root mount is excluded on purpose. `/` is always a mount point, so
 * counting it would make every path look persistent and the warning would
 * never fire - which is the exact failure mode this module exists to prevent.
 */
export function isOnMount(target: string, mountPoints: Set<string>): boolean {
  for (const mountPoint of mountPoints) {
    if (mountPoint === '/') continue
    if (target === mountPoint) return true
    if (target.startsWith(mountPoint.endsWith('/') ? mountPoint : `${mountPoint}/`)) {
      return true
    }
  }

  return false
}

export interface PersistenceReport {
  /** Paths that were checked. */
  checked: string[]
  /** Of those, the ones with no mount point covering them. */
  ephemeral: string[]
  /** True when nothing was checked, e.g. outside the production image. */
  skipped: boolean
}

export function reportPersistence(input: {
  paths: string[]
  mountInfo: string
  enabled: boolean
}): PersistenceReport {
  if (!input.enabled) {
    return { checked: [], ephemeral: [], skipped: true }
  }

  const mountPoints = parseMountInfo(input.mountInfo)
  const checked = [...new Set(input.paths.filter(Boolean))]
  const ephemeral = checked.filter((path) => !isOnMount(path, mountPoints))

  return { checked, ephemeral, skipped: false }
}

export function readMountInfo(file = '/proc/self/mountinfo'): string {
  try {
    return fs.readFileSync(file, 'utf8')
  } catch {
    // Without mountinfo we cannot prove anything, and claiming otherwise would
    // be the same mistake as this module exists to prevent.
    return ''
  }
}

export function formatPersistenceWarning(report: PersistenceReport): string {
  const lines = [
    '',
    '================================================================',
    ' DATA PERSISTENCE WARNING',
    '================================================================',
    ` These paths hold user data but sit on no mounted volume:`,
    ...report.ephemeral.map((path) => `   - ${path}`),
    '',
    ' They live in the container filesystem, so every image rebuild (that is,',
    ' every deploy) destroys them. Repositories and chat history are the two',
    ' that will be lost; chat history is stored by OpenCode under',
    ' XDG_DATA_HOME, not in the SQLite database.',
    '',
    ' Mount them before trusting this deployment:',
    '   dokku storage:ensure-directory ocm-data      --chown 1000',
    '   dokku storage:ensure-directory ocm-workspace --chown 1000',
    '   dokku storage:mount <app> /var/lib/dokku/data/storage/ocm-data:/app/data',
    '   dokku storage:mount <app> /var/lib/dokku/data/storage/ocm-workspace:/workspace',
    '================================================================',
    '',
  ]

  return lines.join('\n')
}
