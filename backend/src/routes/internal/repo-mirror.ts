import { Hono } from 'hono'
import type { Database } from 'bun:sqlite'
import { createReadStream, createWriteStream, mkdtempSync } from 'fs'
import { Readable } from 'stream'
import { pipeline } from 'stream/promises'
import { join } from 'path'
import * as fsp from 'fs/promises'
import {
  MirrorTargetBranchRequestSchema,
  type MirrorTargetEnsureResponse,
  type MirrorTargetPlanResponse,
} from '@opencode-manager/shared/schemas'
import { getRepoById, updateLastPulled, updateRepoBranch, deleteRepo } from '../../db/queries'
import { internalUserOf } from '../../auth/internal-token-middleware'
import { ensureMirrorTargetPath, createRepoRow, isRepoInUse, planMirrorTarget, ensureMirrorTarget } from '../../services/repo'
import { logger } from '../../utils/logger'
import { getErrorMessage } from '../../utils/error-utils'
import { mkdirSyncSafe } from '../../utils/fs-safe'
import { createMirrorTarStream } from '../../services/uploads/mirror-archive'
import { safeGitOut } from '../../services/git/git-commands'
import {
  createMirrorPatch,
  applyMirrorPatch,
  importBundle,
  createBundle,
} from '../../services/git/mirror-ops'
import {
  MIRROR_CHUNK_SIZE,
  TOTAL_PARTS_INVALID_MESSAGE,
  isValidTotalParts,
  createUploadSession,
  readUploadMeta,
  deleteUploadSession,
  getPartPath,
  getStagingRoot,
  extractPartsToStaging,
  atomicSwapIntoPlace,
  carryOverIgnoredFiles,
  discardBackup,
  restoreBackup,
} from '../../services/uploads/mirror-staging'

interface BeginBody {
  create?: boolean
  name?: string
  originUrl?: string
  branch?: string
  force?: boolean
}
import { swallow } from '../../utils/swallow'

interface CommitBody {
  uploadId: string
  totalParts: number
  gzip?: boolean
}

interface PatchBody {
  baseHead?: string | null
  patch?: string
  force?: boolean
}

const LEGACY_UPGRADE_MESSAGE = 'this ocm CLI is too old for this server; upgrade to ocm-cli >= 0.1.2 (the mirror upload protocol changed to chunked uploads)'

export function createInternalRepoMirrorRoutes(db: Database) {
  const app = new Hono()

  app.post('/:repoId/mirror', (c) => {
    return c.json({ error: 'cli_too_old', message: LEGACY_UPGRADE_MESSAGE }, 410)
  })

  app.post('/:repoId/mirror/begin', async (c) => {
    const repoIdRaw = c.req.param('repoId')
    let body: BeginBody
    try {
      body = (await c.req.json()) as BeginBody
    } catch {
      return c.json({ error: 'invalid json body' }, 400)
    }

    const force = body.force === true
    const create = body.create === true

    let repoId: number
    let fullPath: string
    let created = false
    let createdRepoId: number | undefined

    if (repoIdRaw === '0' && create) {
      if (!body.name) return c.json({ error: 'name required', message: 'provide name in body' }, 400)
      const target = ensureMirrorTargetPath(body.name)
      const { repo: newRepo, created: wasCreated } = createRepoRow(db, {
        name: body.name,
        originUrl: body.originUrl,
        localPath: target.localPath,
        fullPath: target.fullPath,
        branch: body.branch,
        // Without an owner the row lands with `user_id IS NULL`, and
        // `canAccessRepoOwner(null, principal)` is true for every non-admin -
        // so the mirror this request just created was immediately deletable by
        // any tenant, and its directory joined the set of paths they could
        // read. The internal token names a user; that is the owner.
        userId: internalUserOf(c)?.id ?? null,
      })
      repoId = newRepo.id
      fullPath = newRepo.fullPath
      created = wasCreated
      createdRepoId = wasCreated ? newRepo.id : undefined

      if (!wasCreated && !force && isRepoInUse(db, repoId)) {
        return c.json({ error: 'repo_in_use', message: 'open OpenCode sessions are using this repo; rerun with force=1' }, 409)
      }
    } else {
      const repoIdNum = Number(repoIdRaw)
      if (!Number.isFinite(repoIdNum)) return c.json({ error: 'invalid repoId' }, 400)
      const repo = getRepoById(db, repoIdNum)
      if (!repo) return c.json({ error: 'repo not found' }, 404)
      repoId = repo.id
      fullPath = repo.fullPath

      if (!force && isRepoInUse(db, repoId)) {
        return c.json({ error: 'repo_in_use', message: 'open OpenCode sessions are using this repo; rerun with force=1' }, 409)
      }
    }

    try {
      const meta = await createUploadSession({ repoId, fullPath, created, createdRepoId, force })
      return c.json({ uploadId: meta.uploadId, repoId, chunkSize: MIRROR_CHUNK_SIZE, created })
    } catch (error) {
      logger.error('mirror begin failed:', error)
      if (createdRepoId !== undefined) {
        try { deleteRepo(db, createdRepoId) } catch { /* ignore */ }
      }
      return c.json({ error: getErrorMessage(error) }, 500)
    }
  })

  app.put('/:repoId/mirror/parts/:uploadId/:index', async (c) => {
    const repoIdRaw = c.req.param('repoId')
    const uploadId = c.req.param('uploadId')
    const indexRaw = c.req.param('index')
    const index = Number(indexRaw)
    if (!Number.isFinite(index) || index < 0 || !Number.isInteger(index)) {
      return c.json({ error: 'invalid index' }, 400)
    }

    const meta = await readUploadMeta(uploadId)
    if (!meta) return c.json({ error: 'upload session not found' }, 404)

    const repoIdNum = Number(repoIdRaw)
    if (!Number.isFinite(repoIdNum) || repoIdNum !== meta.repoId) {
      if (!(repoIdRaw === '0' && meta.created)) {
        return c.json({ error: 'upload session does not belong to repo' }, 403)
      }
    }

    const rawBody = c.req.raw.body
    if (!rawBody) return c.json({ error: 'no body provided' }, 400)

    const partPath = getPartPath(uploadId, index)
    try {
      const body = Readable.fromWeb(rawBody as unknown as Parameters<typeof Readable.fromWeb>[0])
      await pipeline(body, createWriteStream(partPath))
      const stat = await fsp.stat(partPath)
      return c.json({ index, size: stat.size })
    } catch (error) {
      logger.error(`mirror part ${index} upload failed:`, error)
      await fsp.rm(partPath, { force: true }).catch(swallow)
      return c.json({ error: getErrorMessage(error) }, 500)
    }
  })

  app.post('/:repoId/mirror/commit', async (c) => {
    let body: CommitBody
    try {
      body = (await c.req.json()) as CommitBody
    } catch {
      return c.json({ error: 'invalid json body' }, 400)
    }

    const { uploadId, totalParts, gzip } = body
    if (!uploadId) return c.json({ error: 'uploadId required' }, 400)
    if (!isValidTotalParts(totalParts)) return c.json({ error: TOTAL_PARTS_INVALID_MESSAGE }, 400)

    const meta = await readUploadMeta(uploadId)
    if (!meta) return c.json({ error: 'upload session not found' }, 404)

    let backupDir: string | undefined
    let staging: string | undefined
    try {
      const extracted = await extractPartsToStaging(uploadId, totalParts, gzip === true)
      staging = extracted.staging

      const swap = await atomicSwapIntoPlace(extracted.extractedRoot, meta.fullPath)
      backupDir = swap.backupDir

      const branchName = await safeGitOut(meta.fullPath, ['rev-parse', '--abbrev-ref', 'HEAD'])
      const head = await safeGitOut(meta.fullPath, ['rev-parse', 'HEAD'])

      if (branchName) updateRepoBranch(db, meta.repoId, branchName.trim())
      updateLastPulled(db, meta.repoId)

      await carryOverIgnoredFiles(backupDir, meta.fullPath)
      await discardBackup(backupDir)
      backupDir = undefined
      await fsp.rm(staging, { recursive: true, force: true }).catch(swallow)
      staging = undefined
      await deleteUploadSession(uploadId)

      return c.json({
        repoId: meta.repoId,
        fullPath: meta.fullPath,
        branch: branchName?.trim() || null,
        head: head?.trim() || null,
        created: meta.created,
      })
    } catch (error) {
      logger.error('mirror commit failed:', error)
      await restoreBackup(meta.fullPath, backupDir)
      if (meta.createdRepoId !== undefined) {
        try { deleteRepo(db, meta.createdRepoId) } catch { /* ignore */ }
      }
      if (staging) {
        await fsp.rm(staging, { recursive: true, force: true }).catch(swallow)
      }
      await deleteUploadSession(uploadId)
      return c.json({ error: getErrorMessage(error) }, 500)
    }
  })

  app.delete('/:repoId/mirror/uploads/:uploadId', async (c) => {
    const uploadId = c.req.param('uploadId')
    const meta = await readUploadMeta(uploadId)
    if (meta?.createdRepoId !== undefined) {
      try { deleteRepo(db, meta.createdRepoId) } catch { /* ignore */ }
    }
    await deleteUploadSession(uploadId)
    return c.json({ ok: true })
  })

  app.get('/:repoId/mirror/bundle', async (c) => {
    const repoIdRaw = c.req.param('repoId')
    const repoId = Number(repoIdRaw)
    if (!Number.isFinite(repoId)) return c.json({ error: 'invalid repoId' }, 400)
    const repo = getRepoById(db, repoId)
    if (!repo) return c.json({ error: 'repo not found' }, 404)

    let bundlePath: string | undefined
    try {
      bundlePath = await createBundle(repo.fullPath)
      const stream = createReadStream(bundlePath)
      stream.on('close', () => {
        if (bundlePath) fsp.rm(join(bundlePath, '..'), { recursive: true, force: true }).catch(swallow)
      })
      return new Response(Readable.toWeb(stream) as ReadableStream, {
        headers: { 'Content-Type': 'application/octet-stream' },
      })
    } catch (error) {
      logger.error('mirror bundle download failed:', error)
      if (bundlePath) await fsp.rm(join(bundlePath, '..'), { recursive: true, force: true }).catch(swallow)
      return c.json({ error: getErrorMessage(error) }, 500)
    }
  })

  app.post('/:repoId/mirror/bundle', async (c) => {
    const repoIdRaw = c.req.param('repoId')
    const repoId = Number(repoIdRaw)
    if (!Number.isFinite(repoId)) return c.json({ error: 'invalid repoId' }, 400)
    const repo = getRepoById(db, repoId)
    if (!repo) return c.json({ error: 'repo not found' }, 404)
    const force = c.req.query('force') === '1'
    if (isRepoInUse(db, repoId) && !force) {
      return c.json({ error: 'repo_in_use', message: 'open OpenCode sessions are using this repo; rerun with force=1' }, 409)
    }

    const rawBody = c.req.raw.body
    if (!rawBody) return c.json({ error: 'no body provided' }, 400)

    const stagingRoot = getStagingRoot()
    mkdirSyncSafe(stagingRoot)
    const bundleDir = mkdtempSync(join(stagingRoot, 'bundle-upload-'))
    const bundlePath = join(bundleDir, 'repo.bundle')
    const branch = c.req.header('x-ocm-branch')?.trim() || null
    const requireCurrentBranch = c.req.header('x-ocm-require-current-branch')?.trim() === '1'

    try {
      const body = Readable.fromWeb(rawBody as unknown as Parameters<typeof Readable.fromWeb>[0])
      await pipeline(body, createWriteStream(bundlePath))
      await importBundle(repo.fullPath, bundlePath, branch, requireCurrentBranch, force)

      const branchName = await safeGitOut(repo.fullPath, ['rev-parse', '--abbrev-ref', 'HEAD'])
      const head = await safeGitOut(repo.fullPath, ['rev-parse', 'HEAD'])
      if (branchName) updateRepoBranch(db, repoId, branchName.trim())
      updateLastPulled(db, repoId)

      return c.json({
        repoId,
        fullPath: repo.fullPath,
        branch: branchName?.trim() || null,
        head: head?.trim() || null,
        created: false,
      })
    } catch (error) {
      logger.error('mirror bundle upload failed:', error)
      return c.json({ error: getErrorMessage(error) }, 409)
    } finally {
      await fsp.rm(bundleDir, { recursive: true, force: true }).catch(swallow)
    }
  })

  app.get('/:repoId/mirror/target', async (c) => {
    const repoId = Number(c.req.param('repoId'))
    if (!Number.isFinite(repoId)) return c.json({ error: 'invalid repoId' }, 400)
    const branchParsed = MirrorTargetBranchRequestSchema.safeParse({ branch: c.req.query('branch') })
    if (!branchParsed.success) return c.json({ error: 'branch required' }, 400)
    const { branch } = branchParsed.data
    const repo = getRepoById(db, repoId)
    if (!repo) return c.json({ error: 'repo not found' }, 404)

    try {
      const plan = await planMirrorTarget(db, repo, branch)
      const response: MirrorTargetPlanResponse = plan.kind === 'new'
        ? { kind: plan.kind, repoId: null, fullPath: plan.fullPath, localPath: plan.localPath, branch, currentBranch: plan.currentBranch }
        : { kind: plan.kind, repoId: plan.repo.id, fullPath: plan.repo.fullPath, localPath: plan.repo.localPath, branch, currentBranch: plan.currentBranch }
      return c.json(response)
    } catch (error) {
      logger.error('mirror target plan failed:', error)
      return c.json({ error: getErrorMessage(error) }, 500)
    }
  })

  app.post('/:repoId/mirror/target', async (c) => {
    const repoId = Number(c.req.param('repoId'))
    if (!Number.isFinite(repoId)) return c.json({ error: 'invalid repoId' }, 400)
    let json: unknown
    try {
      json = await c.req.json()
    } catch {
      return c.json({ error: 'invalid json body' }, 400)
    }
    const branchParsed = MirrorTargetBranchRequestSchema.safeParse(json)
    if (!branchParsed.success) return c.json({ error: 'branch required' }, 400)
    const { branch } = branchParsed.data
    const repo = getRepoById(db, repoId)
    if (!repo) return c.json({ error: 'repo not found' }, 404)

    try {
      const { repo: target, created } = await ensureMirrorTarget(db, repo, branch)
      const response: MirrorTargetEnsureResponse = {
        repoId: target.id,
        fullPath: target.fullPath,
        localPath: target.localPath,
        branch,
        created,
      }
      return c.json(response)
    } catch (error) {
      logger.error('mirror target ensure failed:', error)
      return c.json({ error: getErrorMessage(error) }, 409)
    }
  })

  app.get('/:repoId/mirror/head', async (c) => {
    const repoIdRaw = c.req.param('repoId')
    const repoId = Number(repoIdRaw)
    if (!Number.isFinite(repoId)) return c.json({ error: 'invalid repoId' }, 400)
    const repo = getRepoById(db, repoId)
    if (!repo) return c.json({ error: 'repo not found' }, 404)

    const branchName = await safeGitOut(repo.fullPath, ['rev-parse', '--abbrev-ref', 'HEAD'])
    const head = await safeGitOut(repo.fullPath, ['rev-parse', 'HEAD'])
    const status = await safeGitOut(repo.fullPath, ['status', '--porcelain', '--untracked-files=all'])
    return c.json({
      repoId: repo.id,
      branch: branchName?.trim() || null,
      head: head?.trim() || null,
      dirty: (status?.trim().length ?? 0) > 0,
    })
  })

  app.get('/:repoId/mirror/contains/:sha', async (c) => {
    const repoIdRaw = c.req.param('repoId')
    const repoId = Number(repoIdRaw)
    if (!Number.isFinite(repoId)) return c.json({ error: 'invalid repoId' }, 400)
    const sha = c.req.param('sha')
    if (!/^[0-9a-f]{7,64}$/i.test(sha)) return c.json({ error: 'invalid sha' }, 400)
    const repo = getRepoById(db, repoId)
    if (!repo) return c.json({ error: 'repo not found' }, 404)

    const ancestry = await safeGitOut(repo.fullPath, ['merge-base', '--is-ancestor', sha, 'HEAD'])
    return c.json({ repoId: repo.id, contained: ancestry !== null })
  })

  app.get('/:repoId/mirror/patch', async (c) => {
    const repoIdRaw = c.req.param('repoId')
    const repoId = Number(repoIdRaw)
    if (!Number.isFinite(repoId)) return c.json({ error: 'invalid repoId' }, 400)
    const repo = getRepoById(db, repoId)
    if (!repo) return c.json({ error: 'repo not found' }, 404)

    try {
      const branchName = await safeGitOut(repo.fullPath, ['rev-parse', '--abbrev-ref', 'HEAD'])
      const head = await safeGitOut(repo.fullPath, ['rev-parse', 'HEAD'])
      const patch = await createMirrorPatch(repo.fullPath)
      return c.json({
        repoId: repo.id,
        branch: branchName?.trim() || null,
        head: head?.trim() || null,
        patch,
      })
    } catch (error) {
      logger.error('mirror patch snapshot failed:', error)
      return c.json({ error: getErrorMessage(error) }, 500)
    }
  })

  app.post('/:repoId/mirror/patch', async (c) => {
    const repoIdRaw = c.req.param('repoId')
    const repoId = Number(repoIdRaw)
    if (!Number.isFinite(repoId)) return c.json({ error: 'invalid repoId' }, 400)

    let body: PatchBody
    try {
      body = (await c.req.json()) as PatchBody
    } catch {
      return c.json({ error: 'invalid json body' }, 400)
    }

    const repo = getRepoById(db, repoId)
    if (!repo) return c.json({ error: 'repo not found' }, 404)
    if (!body.patch && body.patch !== '') return c.json({ error: 'patch required' }, 400)
    if (body.force !== true && isRepoInUse(db, repoId)) {
      return c.json({ error: 'repo_in_use', message: 'open OpenCode sessions are using this repo; rerun with force=1' }, 409)
    }

    try {
      const currentHead = await safeGitOut(repo.fullPath, ['rev-parse', 'HEAD'])
      const currentHeadTrimmed = currentHead?.trim() || null
      const baseHead = body.baseHead?.trim() || null
      if (baseHead && currentHeadTrimmed && baseHead !== currentHeadTrimmed) {
        return c.json({ error: 'head_mismatch', message: 'Manager repo HEAD differs from patch base' }, 409)
      }

      await applyMirrorPatch(repo.fullPath, body.patch)

      const branchName = await safeGitOut(repo.fullPath, ['rev-parse', '--abbrev-ref', 'HEAD'])
      const head = await safeGitOut(repo.fullPath, ['rev-parse', 'HEAD'])

      if (branchName) updateRepoBranch(db, repoId, branchName.trim())
      updateLastPulled(db, repoId)

      return c.json({
        repoId,
        fullPath: repo.fullPath,
        branch: branchName?.trim() || null,
        head: head?.trim() || null,
        created: false,
        applied: true,
      })
    } catch (error) {
      logger.error('mirror patch failed:', error)
      return c.json({ error: getErrorMessage(error) }, 409)
    }
  })

  app.get('/:repoId/mirror', async (c) => {
    const repoIdRaw = c.req.param('repoId')
    const repoId = Number(repoIdRaw)
    if (!Number.isFinite(repoId)) return c.json({ error: 'invalid repoId' }, 400)
    const repo = getRepoById(db, repoId)
    if (!repo) return c.json({ error: 'repo not found' }, 404)

    const compress = c.req.query('compress') === 'gzip'
    const fullPath = repo.fullPath

    const stream = await createMirrorTarStream(fullPath, compress)

    return new Response(stream, {
      headers: {
        ...(compress ? { 'Content-Type': 'application/gzip' } : { 'Content-Type': 'application/x-tar' }),
      },
    })
  })

  return app
}
