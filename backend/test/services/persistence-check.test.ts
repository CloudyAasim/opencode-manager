import { describe, expect, it } from 'vitest'
import {
  formatPersistenceWarning,
  isOnMount,
  parseMountInfo,
  readMountInfo,
  reportPersistence,
} from '../../src/services/persistence-check'
import { IMAGE_ONLY_MOUNTINFO, WITH_STDOKKU_MOUNTS_MOUNTINFO } from './mountinfo-fixtures'

describe('parseMountInfo', () => {
  it('reads the mount point out of each line', () => {
    const mountPoints = parseMountInfo(IMAGE_ONLY_MOUNTINFO)
    expect(mountPoints.has('/')).toBe(true)
    expect(mountPoints.has('/proc')).toBe(true)
    expect(mountPoints.has('/dev')).toBe(true)
  })

  it('finds no volume where the image only created the directory', () => {
    const mountPoints = parseMountInfo(IMAGE_ONLY_MOUNTINFO)
    expect(mountPoints.has('/workspace')).toBe(false)
    expect(mountPoints.has('/app/data')).toBe(false)
  })

  it('finds both volumes once Dokku mounts them', () => {
    const mountPoints = parseMountInfo(WITH_STDOKKU_MOUNTS_MOUNTINFO)
    expect(mountPoints.has('/workspace')).toBe(true)
    expect(mountPoints.has('/app/data')).toBe(true)
  })

  it('does not treat a non-mount line as a mount point', () => {
    expect(parseMountInfo('').size).toBe(0)
    expect(parseMountInfo('garbage without enough fields').size).toBe(0)
  })
})

describe('isOnMount', () => {
  const mountPoints = parseMountInfo(WITH_STDOKKU_MOUNTS_MOUNTINFO)

  it('accepts the mount point itself', () => {
    expect(isOnMount('/workspace', mountPoints)).toBe(true)
  })

  it('accepts a path under a mount point', () => {
    expect(isOnMount('/workspace/.opencode/state', mountPoints)).toBe(true)
    expect(isOnMount('/app/data/opencode.db', mountPoints)).toBe(true)
  })

  it('does not accept a sibling that merely shares a name prefix', () => {
    // /workspace-backup must not be covered by a mount on /workspace.
    expect(isOnMount('/workspace-backup/repo', mountPoints)).toBe(false)
  })
})

describe('reportPersistence', () => {
  const paths = ['/app/data/opencode.db', '/workspace']

  it('names both data paths when neither is mounted', () => {
    const report = reportPersistence({
      paths,
      mountInfo: IMAGE_ONLY_MOUNTINFO,
      enabled: true,
    })

    expect(report.skipped).toBe(false)
    expect(report.ephemeral.sort()).toEqual(['/app/data/opencode.db', '/workspace'])
  })

  it('finds nothing once the documented mounts exist', () => {
    const report = reportPersistence({
      paths,
      mountInfo: WITH_STDOKKU_MOUNTS_MOUNTINFO,
      enabled: true,
    })

    expect(report.ephemeral).toEqual([])
    expect(report.checked.sort()).toEqual(['/app/data/opencode.db', '/workspace'])
  })

  it('checks the chat history path, which is not in the database', () => {
    // Regression guard for the actual data loss: OpenCode is given
    // XDG_DATA_HOME under WORKSPACE_PATH, so this path is every conversation.
    const report = reportPersistence({
      paths: ['/workspace/.opencode/state/opencode'],
      mountInfo: IMAGE_ONLY_MOUNTINFO,
      enabled: true,
    })

    expect(report.ephemeral).toEqual(['/workspace/.opencode/state/opencode'])
  })

  it('stays quiet outside the production image', () => {
    const report = reportPersistence({
      paths,
      mountInfo: IMAGE_ONLY_MOUNTINFO,
      enabled: false,
    })

    expect(report.skipped).toBe(true)
    expect(report.ephemeral).toEqual([])
  })
})

describe('readMountInfo', () => {
  it('returns empty text when the file cannot be read', () => {
    // Better to stay silent than to claim a path is unsafe on no evidence.
    expect(readMountInfo('/definitely/not/here')).toBe('')
  })

  it('reports every path as unverifiable rather than safe when it cannot read', () => {
    const report = reportPersistence({
      paths: ['/workspace'],
      mountInfo: readMountInfo('/definitely/not/here'),
      enabled: true,
    })

    expect(report.ephemeral).toEqual(['/workspace'])
  })
})

describe('formatPersistenceWarning', () => {
  it('names the offending paths and the fix', () => {
    const report = reportPersistence({
      paths: ['/app/data/opencode.db', '/workspace'],
      mountInfo: IMAGE_ONLY_MOUNTINFO,
      enabled: true,
    })

    const warning = formatPersistenceWarning(report)
    expect(warning).toContain('/app/data/opencode.db')
    expect(warning).toContain('/workspace')
    expect(warning).toContain('dokku storage:mount')
    // The message has to say what is lost, not just that something is wrong.
    expect(warning).toContain('chat history')
  })
})
