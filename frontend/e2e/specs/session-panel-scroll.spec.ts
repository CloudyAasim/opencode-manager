import { test, expect, type Locator, type Page, type CDPSession } from '@playwright/test'
import { installApiMocks, makeSession } from '../helpers/api-mocks'

const REPO = { id: 1, fullPath: '/workspace/repos/demo', localPath: 'demo', cloneStatus: 'ready' as const }

const MANY_FILES = Array.from({ length: 400 }, (_, index) => ({
  name: `file-${String(index).padStart(3, '0')}.ts`,
  isDirectory: false,
}))

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

function mockListing(page: Page, payload: unknown) {
  return page.route(/.*\/api\/files(\?.*)?$/, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(payload) }),
  )
}

const DRAG_STEPS = 8
const DRAG_STEP_MS = 8

// Measured, not guessed. With 400 rows this listing needs 12,227px of travel
// (mobile) and 12,157px (desktop) to put the last row on screen. A 500px flick
// reached the end in 19 rounds on a phone and 26 on a desktop - against a
// 30-round budget, that is a 1.15x margin on desktop, which is the same knife
// edge that made an earlier version of this gate flaky: it only passed when a
// fling happened to carry far enough. At 700px the same run needs 14 and 17,
// so the budget below is roughly 1.8x of the worst case.
const FLICK = 700
const FLICK_BUDGET = 30

/**
 * A finger on the listing, dispatched through CDP.
 *
 * Setting `scrollTop` proves the box can hold an offset, which says nothing
 * about whether a finger can produce one. This bug was invisible to every
 * `scrollTop` assertion in the suite precisely because the broken box has no
 * overflow to hold an offset in the first place.
 */
async function dragOn(page: Page, target: Locator, distance: number) {
  const client = (await page.context().newCDPSession(page)) as CDPSession
  const box = await target.first().boundingBox()
  if (!box) throw new Error('the target has no box')
  const viewportHeight = await page.evaluate(() => window.innerHeight)
  const x = Math.round(box.x + box.width / 2)
  const startY = Math.min(viewportHeight - 4, Math.round(box.y + box.height * 0.8))
  const endY = Math.max(4, startY - distance)

  await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y: startY, id: 1 }] })
  for (let step = 1; step <= DRAG_STEPS; step += 1) {
    const y = Math.round(startY + ((endY - startY) * step) / DRAG_STEPS)
    await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y, id: 1 }] })
    await page.waitForTimeout(DRAG_STEP_MS)
  }
  await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  await client.detach()
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

async function pollUntil(check: () => Promise<boolean>, timeout: number): Promise<boolean> {
  const deadline = Date.now() + timeout
  for (;;) {
    if (await check()) return true
    if (Date.now() >= deadline) return false
    await sleep(80)
  }
}

const scrollTopOf = (scroller: Locator) => scroller.evaluate((node) => node.scrollTop)

async function openSessionPanelFiles(page: Page) {
  await installApiMocks(page, {
    repos: [REPO],
    sessionsByDirectory: { [REPO.fullPath]: [makeSession('ses_panel', REPO.fullPath)] },
  })
  await mockListing(page, directory(MANY_FILES))

  await page.goto('/repos/1/sessions/ses_panel')
  await expect(page.locator('#root')).not.toBeEmpty()

  const toggle = page.getByRole('button', { name: /detail|详情/i }).first()
  await expect(toggle).toBeVisible({ timeout: 15_000 })
  await toggle.click()

  const scroller = page.locator('[data-testid="file-tree-scroller"]')
  await expect(scroller).toBeVisible()
  await expect(scroller).toContainText('file-000.ts')
  return scroller
}

test.describe('the file tree in a session panel', () => {
  test('the listing is a scroll container rather than a box as tall as its content', async ({ page }) => {
    const scroller = await openSessionPanelFiles(page)

    const metrics = await scroller.evaluate((node) => ({
      clientHeight: node.clientHeight,
      scrollHeight: node.scrollHeight,
      viewport: window.innerHeight,
    }))

    // This is the check that the bug fails. The panel was a bottom sheet with
    // `max-h-[78vh]`, which caps a box without defining it: the tree was
    // 12,808px tall inside an 844px screen, its own `clientHeight` equalled its
    // `scrollHeight`, and a box with no overflow cannot scroll at all - not
    // even into a rubber-band.
    expect(metrics.scrollHeight).toBeGreaterThan(metrics.clientHeight)
    // And it has to be bounded by the screen, not merely by the panel.
    expect(metrics.clientHeight).toBeLessThanOrEqual(metrics.viewport)
  })

  test('a finger drags the listing in the session panel', async ({ page }) => {
    const scroller = await openSessionPanelFiles(page)

    expect(await scrollTopOf(scroller)).toBe(0)
    await dragOn(page, scroller, FLICK)
    const moved = await pollUntil(async () => (await scrollTopOf(scroller)) > 0, 1500)
    expect(moved).toBe(true)
  })

  test('the whole listing in the session panel stays reachable by touch', async ({ page }) => {
    const scroller = await openSessionPanelFiles(page)
    const lastRow = page.getByText('file-399.ts')

    let reached = false
    for (let round = 0; round < FLICK_BUDGET && !reached; round += 1) {
      await dragOn(page, scroller, FLICK)
      reached = await pollUntil(
        () =>
          lastRow.evaluate((node) => {
            const panel = document.querySelector('aside')
            if (!panel) return false
            const item = node.getBoundingClientRect()
            const box = panel.getBoundingClientRect()
            return item.top >= box.top - 1 && item.bottom <= box.bottom + 1
          }),
        150,
      )
    }

    // Containment is not enough: while the sheet clips a too-tall box, the
    // last row is still in the document and `toContainText` passes on it. What
    // has to hold is that the row is on the screen, inside the panel.
    expect(reached).toBe(true)
  })
})

test.describe('a file opened from the listing', () => {
  // Phone only, and not because the control is hard to reach there. On a
  // desktop the preview renders in the split pane beside the listing rather
  // than over it, so there is nothing to close - a test looking for a close
  // button there is looking for a control that should not exist.
  test.skip(({ viewport }) => (viewport?.width ?? 0) >= 768, 'the desktop preview is a pane, not a modal')

  test('can be closed without reaching for the system back button', async ({ page }) => {
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

    const host = page.locator('[data-testid="file-preview-modal-host"]')
    await expect(host).toContainText('const answer = 42', { timeout: 15_000 })

    // The only caller never passes `showFilePreviewHeader`, so the X inside
    // FilePreview's header was never rendered: a file opened from the listing
    // had no close control at all, only a swipe-back or the system button.
    const close = page.getByRole('button', { name: /close preview|关闭预览/i }).first()
    await expect(close).toBeVisible()
    await close.click()
    await expect(host).not.toContainText('const answer = 42')
  })
})
