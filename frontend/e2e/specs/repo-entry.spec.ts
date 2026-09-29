import { test, expect } from '@playwright/test'
import { installApiMocks, makeSession } from '../helpers/api-mocks'

test.describe('repo entry route', () => {
  test('redirects to the newest session without painting an intermediate screen', async ({ page }) => {
    const repo = { id: 1, fullPath: '/workspace/repos/demo', localPath: 'demo', cloneStatus: 'ready' as const }
    await installApiMocks(page, {
      repos: [repo],
      sessionsByDirectory: { [repo.fullPath]: [makeSession('ses_newest', repo.fullPath)] },
    })

    await page.goto('/repos/1')

    await expect(page).toHaveURL(/\/repos\/1\/sessions\/ses_newest$/)
  })

  test('still redirects when the session list answers slowly', async ({ page }) => {
    const repo = { id: 1, fullPath: '/workspace/repos/demo', localPath: 'demo', cloneStatus: 'ready' as const }
    await installApiMocks(page, {
      repos: [repo],
      sessionsByDirectory: { [repo.fullPath]: [makeSession('ses_slow', repo.fullPath)] },
      latency: { repoMs: 1200, sessionsMs: 1500 },
    })

    await page.goto('/repos/1')

    await expect(page).toHaveURL(/\/repos\/1\/sessions\/ses_slow$/, { timeout: 20000 })
    await expect(page).not.toHaveURL(/undefined/)
  })

  test('never navigates to a session id of undefined', async ({ page }) => {
    const repo = { id: 1, fullPath: '/workspace/repos/demo', localPath: 'demo', cloneStatus: 'ready' as const }
    await installApiMocks(page, {
      repos: [repo],
      sessionsByDirectory: { [repo.fullPath]: [] },
      latency: { repoMs: 300, sessionsMs: 900 },
    })

    const seen: string[] = []
    page.on('framenavigated', (frame) => {
      if (frame === page.mainFrame()) seen.push(frame.url())
    })

    await page.goto('/repos/1')
    await page.waitForTimeout(6000)

    expect(seen.filter((url) => url.includes('/sessions/undefined'))).toHaveLength(0)
  })

  test('a repo with no sessions lands on a usable session page, not a not-found screen', async ({ page }) => {
    const repo = { id: 1, fullPath: '/workspace/repos/demo', localPath: 'demo', cloneStatus: 'ready' as const }
    await installApiMocks(page, {
      repos: [repo],
      sessionsByDirectory: { [repo.fullPath]: [] },
    })

    await page.goto('/repos/1')
    await page.waitForTimeout(4000)

    const body = await page.locator('body').innerText()
    expect(body).not.toContain('未找到会话')
    expect(body).not.toContain('Session not found')
    expect(body).not.toContain('返回会话列表')
    expect(body).not.toContain('Back to sessions')
  })

  test('the session page exposes the worktree switcher that used to live on the project page', async ({ page }) => {
    const repo = { id: 1, fullPath: '/workspace/repos/demo', localPath: 'demo', cloneStatus: 'ready' as const }
    await installApiMocks(page, {
      repos: [repo],
      sessionsByDirectory: { [repo.fullPath]: [makeSession('ses_a', repo.fullPath)] },
    })

    await page.goto('/repos/1')
    await expect(page).toHaveURL(/\/sessions\/ses_a$/)

    await expect(page.locator('body')).toContainText(/Workspace|工作区/, { timeout: 15000 })
  })
})

test.describe('repo entry route failures', () => {
  test('shows the repository-not-found fallback for an unknown repo instead of a blank page', async ({ page }) => {
    await installApiMocks(page, { repos: [] })

    await page.goto('/repos/999')

    const body = page.locator('body')
    await expect(body).toContainText(/Repository not found|未找到仓库|仓库不存在/, { timeout: 15000 })
    await expect(body).toContainText(/Back to repositories|返回仓库列表|返回项目列表/)
  })
})
