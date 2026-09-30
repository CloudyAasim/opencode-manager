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

    const metrics = await scroller.evaluate((node) => ({
      clientHeight: node.clientHeight,
      scrollHeight: node.scrollHeight,
      rows: node.querySelectorAll('button').length,
      pageScrolls: document.documentElement.scrollHeight > window.innerHeight + 2,
    }))
    expect(metrics.rows).toBeGreaterThan(0)
    expect(metrics.rows).toBeLessThan(120)

    expect(metrics.scrollHeight).toBeGreaterThan(metrics.clientHeight)
    expect(metrics.pageScrolls).toBe(false)

    await scroller.evaluate((node) => {
      node.scrollTop = node.scrollHeight
    })
    await expect(scroller).toContainText('file-399.ts')
    const afterScroll = await scroller.evaluate((node) => node.querySelectorAll('[data-tree-row]').length)
    expect(afterScroll).toBeLessThan(120)
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

test.describe('file tree at scale', () => {
  test('windows a large directory', async ({ page }) => {
    await signIn(page)
    await installApiMocks(page, { repos: [REPO] })

    const children = Array.from({ length: 200 }, (_, index) => ({
      name: `entry-${String(index).padStart(3, '0')}.ts`,
      path: `entry-${String(index).padStart(3, '0')}.ts`,
      isDirectory: false,
      size: 128,
      lastModified: new Date(0).toISOString(),
    }))

    await mockListing(page, directory(children))

    await page.goto('/files')
    const scroller = page.locator('[data-testid="file-list-scroller"]')
    await expect(scroller).toBeVisible()
    await expect(scroller).toContainText('entry-000.ts')

    const initial = await scroller.evaluate((node) => ({
      total: node.scrollHeight,
      visible: node.clientHeight,
      rows: node.querySelectorAll('[data-tree-row]').length,
    }))

    expect(initial.total).toBeGreaterThan(initial.visible)
    expect(initial.rows).toBeGreaterThan(0)
    expect(initial.rows).toBeLessThan(120)

    await scroller.evaluate((node) => {
      node.scrollTop = node.scrollHeight
    })
    await expect(scroller).toContainText('entry-199.ts')
    const tail = await scroller.evaluate((node) => node.querySelectorAll('[data-tree-row]').length)
    expect(tail).toBeLessThan(120)
  })

})

test.describe('file tree expansion', () => {
  test('expands a folder in place without leaving the current directory', async ({ page }) => {
    await signIn(page)
    await installApiMocks(page, { repos: [REPO] })

    const rootListing = {
      name: 'root',
      path: '',
      isDirectory: true,
      size: 0,
      workspaceRoot: REPO.fullPath,
      children: [
        { name: 'config', path: 'config', isDirectory: true, size: 0, lastModified: new Date(0).toISOString(), children: [] },
        { name: 'readme.md', path: 'readme.md', isDirectory: false, size: 10, lastModified: new Date(0).toISOString() },
      ],
    }

    const configListing = {
      name: 'config',
      path: 'config',
      isDirectory: true,
      size: 0,
      children: [
        { name: 'settings.json', path: 'config/settings.json', isDirectory: false, size: 5, lastModified: new Date(0).toISOString() },
      ],
    }

    await page.route(/.*\/api\/files(\?.*)?$/, (route) => {
      const requested = new URL(route.request().url()).searchParams.get('path') ?? ''
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(requested === 'config' ? configListing : rootListing),
      })
    })

    await page.goto('/files')
    const scroller = page.locator('[data-testid="file-list-scroller"]')
    await expect(scroller).toBeVisible()
    await expect(scroller).toContainText('readme.md')

    await page.locator('[data-tree-toggle="config"]').click()

    const child = page.locator('[data-tree-row="config/settings.json"]')
    await expect(child).toBeVisible()
    await expect(scroller).toContainText('readme.md')

    const rows = await page.evaluate(() =>
      [...document.querySelectorAll('[data-tree-row]')].map((el) => el.getAttribute('data-tree-row')),
    )
    expect(rows).toEqual(expect.arrayContaining(['config', 'config/settings.json', 'readme.md']))
  })
})

test.describe('preview width containment', () => {
  const LONG_LINE = `const value = "${'A'.repeat(320)}";`

  async function openPreviewWith(page: import('@playwright/test').Page, content: string) {
    await signIn(page)
    await installApiMocks(page, { repos: [REPO] })
    await page.route(/.*\/api\/files(\/ignored-paths)?(\?.*)?$/, (route) => {
      const url = new URL(route.request().url())
      if (url.pathname.endsWith('/ignored-paths')) {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ ignoredPaths: [] }),
        })
      }
      const target = url.searchParams.get('path') ?? ''
      if (target === 'wide.ts') {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            name: 'wide.ts',
            path: 'wide.ts',
            isDirectory: false,
            size: content.length,
            mimeType: 'text/plain',
            lastModified: new Date(0).toISOString(),
            content: btoa(content),
          }),
        })
      }
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          name: 'root',
          path: '',
          isDirectory: true,
          size: 0,
          workspaceRoot: REPO.fullPath,
          children: [
            { name: 'wide.ts', path: 'wide.ts', isDirectory: false, size: content.length, lastModified: new Date(0).toISOString() },
          ],
        }),
      })
    })
    await page.goto('/files')
    await expect(page.locator('[data-testid="file-list-scroller"]')).toBeVisible()
    await page.getByText('wide.ts').first().click()
  }

  test('a 320-character line stays inside the preview pane', async ({ page }) => {
    const content = Array.from({ length: 40 }, (_, index) => (index === 0 ? LONG_LINE : `line ${index} `)).join('\n')
    await openPreviewWith(page, content)

    const measurement = await page.evaluate(() => {
      const node = [...document.querySelectorAll('pre')].find((el) => el.textContent?.includes('const value'))
      if (!node) return null
      const pre = node.getBoundingClientRect()
      const pane = node.closest('[data-preview-root]')?.getBoundingClientRect() ?? pre
      return {
        preWidth: Math.round(pre.width),
        paneWidth: Math.round(pane.width),
        overflowsBy: Math.round(pre.right - pane.right),
        documentOverflows: document.documentElement.scrollWidth > window.innerWidth + 2,
      }
    })

    expect(measurement).not.toBeNull()
    expect(measurement?.overflowsBy).toBeLessThanOrEqual(2)
    expect(measurement?.preWidth).toBeLessThanOrEqual(measurement?.paneWidth ?? Infinity)
    expect(measurement?.documentOverflows).toBe(false)
  })

  test('the preview never widens the document', async ({ page }) => {
    const content = Array.from({ length: 60 }, (_, index) => (index === 0 ? LONG_LINE : `line ${index} `)).join('\n')
    await openPreviewWith(page, content)

    await page.waitForTimeout(500)
    const documentWidth = await page.evaluate(() => document.documentElement.scrollWidth)
    const viewport = await page.evaluate(() => window.innerWidth)
    expect(documentWidth).toBeLessThanOrEqual(viewport + 2)
  })
})

test.describe('preview scrolling', () => {
  const TALL_CONTENT = Array.from({ length: 200 }, (_, index) => `line ${index} some content here`).join('\n')

  async function openTallFile(page: import('@playwright/test').Page) {
    await signIn(page)
    await installApiMocks(page, { repos: [REPO] })
    await page.route(/.*\/api\/files(\/ignored-paths)?(\?.*)?$/, (route) => {
      const url = new URL(route.request().url())
      if (url.pathname.endsWith('/ignored-paths')) {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ ignoredPaths: [] }),
        })
      }
      const target = url.searchParams.get('path') ?? ''
      if (target === 'tall.txt') {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            name: 'tall.txt',
            path: 'tall.txt',
            isDirectory: false,
            size: TALL_CONTENT.length,
            mimeType: 'text/plain',
            lastModified: new Date(0).toISOString(),
            content: btoa(TALL_CONTENT),
          }),
        })
      }
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          name: 'root',
          path: '',
          isDirectory: true,
          size: 0,
          workspaceRoot: REPO.fullPath,
          children: [
            { name: 'tall.txt', path: 'tall.txt', isDirectory: false, size: TALL_CONTENT.length, lastModified: new Date(0).toISOString() },
          ],
        }),
      })
    })
    await page.goto('/files')
    await expect(page.locator('[data-testid="file-list-scroller"]')).toBeVisible()
    await page.locator('[data-tree-row="tall.txt"]').click()
    await expect(page.locator('[data-preview-root]')).toBeVisible({ timeout: 15_000 })
  }

  test.skip(({ viewport }) => (viewport?.width ?? 0) < 768, 'the split pane is desktop only')

  test('the preview is bounded by the viewport instead of growing to fit the file', async ({ page }) => {
    await openTallFile(page)

    const metrics = await page.evaluate(() => {
      const root = document.querySelector('[data-preview-root]')
      if (!root) return null
      return {
        rootHeight: Math.round(root.getBoundingClientRect().height),
        viewport: window.innerHeight,
        documentScrolls: document.documentElement.scrollHeight > window.innerHeight + 2,
      }
    })

    expect(metrics).not.toBeNull()
    expect(metrics?.rootHeight).toBeLessThanOrEqual((metrics?.viewport ?? 0) + 2)
    expect(metrics?.documentScrolls).toBe(false)
  })

  test('a file taller than the pane scrolls inside the pane', async ({ page }) => {
    await openTallFile(page)

    const scrolled = await page.evaluate(() => {
      const candidates = [...document.querySelectorAll('[data-preview-root] *')].filter((el) => {
        const style = getComputedStyle(el)
        return (
          (style.overflowY === 'auto' || style.overflowY === 'scroll') &&
          el.scrollHeight > el.clientHeight + 2
        )
      })
      const target = candidates[0] as HTMLElement | undefined
      if (!target) return { found: false }
      target.scrollTop = 500
      return { found: true, scrollTop: Math.round(target.scrollTop), scrollHeight: target.scrollHeight, clientHeight: target.clientHeight }
    })

    expect(scrolled.found).toBe(true)
    expect(scrolled.scrollTop).toBeGreaterThan(0)
    expect(scrolled.scrollHeight).toBeGreaterThan(scrolled.clientHeight ?? 0)
  })
})
