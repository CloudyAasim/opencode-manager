import { test, expect, type Page, type Route } from '@playwright/test'
import { installApiMocks } from '../helpers/api-mocks'

const REPO = { id: 1, fullPath: '/workspace/repos/demo', localPath: 'demo', cloneStatus: 'ready' as const }

function directory(children: Array<{ name: string; isDirectory: boolean }>) {
  return {
    name: 'root',
    path: '',
    isDirectory: true,
    size: 0,
    workspaceRoot: '/workspace/repos/demo',
    children: children.map((child) => ({
      name: child.name,
      path: child.name,
      isDirectory: child.isDirectory,
      size: child.isDirectory ? 0 : 2048,
      lastModified: new Date(0).toISOString(),
    })),
  }
}

const MANY_FILES = Array.from({ length: 400 }, (_, index) => ({
  name: `file-${String(index).padStart(3, '0')}.ts`,
  isDirectory: false,
}))

async function signIn(page: Page) {
  await page.route('**/api/auth/get-session', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        session: { id: 's1', userId: 'u1', expiresAt: '2099-01-01T00:00:00.000Z' },
        user: { id: 'u1', email: 'admin@opencode.local', name: 'Admin', role: 'admin' },
      }),
    }),
  )
  await page.route('**/api/auth-info/config', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }),
  )
}

function mockListing(page: Page, payload: unknown) {
  return page.route(/.*\/api\/files(\?.*)?$/, (route: Route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(payload),
    }),
  )
}

test.describe('files page on a phone', () => {
  test('a long listing scrolls inside the list instead of the page', async ({ page }) => {
    await signIn(page)
    await installApiMocks(page, { repos: [REPO] })
    await mockListing(page, directory(MANY_FILES))

    await page.goto('/files')
    const scroller = page.locator('[data-testid="file-list-scroller"]')
    await expect(scroller).toBeVisible()
    await expect(scroller).toContainText('file-000.ts')
    await expect(scroller).toContainText('file-399.ts')

    const metrics = await scroller.evaluate((node) => ({
      clientHeight: node.clientHeight,
      scrollHeight: node.scrollHeight,
      rows: node.querySelectorAll('button').length,
      pageScrolls: document.documentElement.scrollHeight > window.innerHeight + 2,
    }))
    expect(metrics.rows).toBeGreaterThan(50)

    expect(metrics.scrollHeight).toBeGreaterThan(metrics.clientHeight)
    expect(metrics.pageScrolls).toBe(false)

    await scroller.evaluate((node) => {
      node.scrollTop = node.scrollHeight
    })
    await expect(scroller).toContainText('file-399.ts')
  })

  test('the back control leaves the files page', async ({ page }) => {
    await signIn(page)
    await installApiMocks(page, { repos: [REPO] })
    await mockListing(page, directory(MANY_FILES.slice(0, 3)))

    await page.goto('/files')
    await expect(page.locator('[data-testid="file-list-scroller"]')).toBeVisible()

    await page.getByRole('button', { name: /back|返回/i }).first().click()
    await expect(page).not.toHaveURL(/\/files$/)
  })

  test('picking a file previews it without exceeding the viewport', async ({ page, isMobile }) => {
    await signIn(page)
    await installApiMocks(page, { repos: [REPO] })
    await mockListing(page, directory(MANY_FILES.slice(0, 5)))
    await page.route(/.*\/api\/files\?path=file-000\.ts/, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          name: 'file-000.ts',
          path: 'file-000.ts',
          isDirectory: false,
          size: 24,
          mimeType: 'text/plain',
          lastModified: new Date(0).toISOString(),
          content: btoa('const answer = 42\n'),
        }),
      }),
    )

    await page.goto('/files')
    await expect(page.locator('[data-testid="file-list-scroller"]')).toBeVisible()
    await page.getByText('file-000.ts').first().click()

    const modalHost = page.locator('[data-testid="file-preview-modal-host"]')
    if (isMobile) {
      await expect(modalHost).not.toHaveAttribute('hidden', '')
      await expect(modalHost).toContainText('const answer = 42', { timeout: 15_000 })
    } else {
      await expect(page.locator('[data-testid="file-preview-surface"]')).toContainText('file-000.ts', {
        timeout: 15_000,
      })
    }

    const fits = await page.evaluate(() => {
      const doc = document.documentElement
      return {
        overflowsHorizontally: doc.scrollWidth > window.innerWidth + 2,
        overflowsVertically: doc.scrollHeight > window.innerHeight + 2,
      }
    })
    expect(fits.overflowsHorizontally).toBe(false)
    expect(fits.overflowsVertically).toBe(false)
  })
})
