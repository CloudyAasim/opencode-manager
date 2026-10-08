import { test, expect, type Locator, type Page, type CDPSession } from '@playwright/test'
import { installApiMocks } from '../helpers/api-mocks'

const REPO = { id: 1, fullPath: '/workspace/repos/demo', localPath: 'demo', cloneStatus: 'ready' as const }

// 400 lines is ~12KB, comfortably under VIRTUALIZATION_THRESHOLD_BYTES (50_000),
// so this renders down the ordinary source-file branch. The virtualized branch
// hands scrolling to VirtualizedTextView and would not exercise the bug at all.
const LINES = 400
const BIG_TEXT = Array.from(
  { length: LINES },
  (_, index) => `line ${String(index).padStart(3, '0')} of the file body`,
).join('\n')

const DRAG_STEPS = 8
const DRAG_STEP_MS = 8

const FLICK = 700
// Measured, not guessed. Three consecutive runs on both projects needed 4, 5,
// 5, 5, 4 and 6 rounds to put the last of 400 lines on screen, so the worst
// case seen is 6. The budget is 14 - about 2.3x of that. A budget picked to sit
// just above the measurement is the same knife edge that made an earlier gate
// flaky: it only passes when a fling happens to carry far enough.
const FLICK_BUDGET = 14

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

/**
 * One route for both the listing and the file.
 *
 * Two overlapping `page.route` calls would work only if Playwright's precedence
 * landed the way this test needs, and a suite that depends on registration
 * order is a suite that breaks when someone reorders the setup. Dispatching on
 * the query string makes it independent of that.
 */
async function openLongPreview(page: Page): Promise<Locator> {
  await installApiMocks(page, { repos: [REPO] })

  await page.route(/.*\/api\/files(\?.*)?$/, (route) => {
    const requested = new URL(route.request().url()).searchParams.get('path')
    if (requested === 'file-000.ts') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          name: 'file-000.ts',
          path: 'file-000.ts',
          isDirectory: false,
          size: BIG_TEXT.length,
          mimeType: 'text/plain',
          lastModified: new Date(0).toISOString(),
          content: btoa(BIG_TEXT),
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
        workspaceRoot: '/workspace/repos/demo',
        children: [
          {
            name: 'file-000.ts',
            path: 'file-000.ts',
            isDirectory: false,
            size: BIG_TEXT.length,
            lastModified: new Date(0).toISOString(),
          },
        ],
      }),
    })
  })

  await page.goto('/files')
  await expect(page.locator('[data-testid="file-list-scroller"]')).toBeVisible()
  await page.getByText('file-000.ts').first().click()

  const scroller = page.locator('[data-testid="file-preview-scroller"]')
  await expect(scroller).toBeVisible({ timeout: 15_000 })
  await expect(scroller).toContainText('line 000')
  return scroller
}

test.describe('which box in the file preview scrolls', () => {
  test('the box carrying overscroll-contain is the box that actually overflows', async ({ page }) => {
    const scroller = await openLongPreview(page)

    const metrics = await scroller.evaluate((node) => ({
      clientHeight: node.clientHeight,
      scrollHeight: node.scrollHeight,
      overscrollY: getComputedStyle(node).overscrollBehaviorY,
      overflowY: getComputedStyle(node).overflowY,
    }))

    // Before the fix this box reported `clientHeight == scrollHeight` - 812 and
    // 812 - and never scrolled. `overscroll-contain` was on it the whole time,
    // stopping a scroll from chaining into the page on an element that had
    // nothing to scroll.
    expect(metrics.scrollHeight).toBeGreaterThan(metrics.clientHeight)
    expect(metrics.overflowY).toBe('auto')
    expect(metrics.overscrollY).toContain('contain')
  })

  test('the padding wrapper is not a scroll container in its own right', async ({ page }) => {
    await openLongPreview(page)

    const overflowY = await page
      .locator('[data-testid="file-preview-body"]')
      .evaluate((node) => getComputedStyle(node).overflowY)

    // This is the check that catches the actual mistake. A single stray
    // `overflow-x-hidden` on this wrapper was enough: CSS computes a `visible`
    // axis as `auto` once the other axis is not `visible`, so the wrapper
    // silently became the scroll container and took 8,216px of overflow with
    // it, while the box above stood still. Its `scrollHeight` staying larger
    // than its `clientHeight` is fine and expected - it overflows visibly, the
    // parent clips it - what must not happen is it acquiring `auto` and
    // scrolling on its own.
    expect(overflowY).toBe('visible')
  })

  test('a finger drags the preview', async ({ page }) => {
    const scroller = await openLongPreview(page)

    expect(await scrollTopOf(scroller)).toBe(0)
    await dragOn(page, scroller, FLICK)
    const moved = await pollUntil(async () => (await scrollTopOf(scroller)) > 0, 1500)
    expect(moved).toBe(true)
  })

  test('the last line stays reachable by touch', async ({ page }) => {
    const scroller = await openLongPreview(page)
    const lastLine = page.getByText(`line ${LINES - 1} of the file body`).first()

    let reached = false
    let rounds = 0
    for (; rounds < FLICK_BUDGET && !reached; rounds += 1) {
      await dragOn(page, scroller, FLICK)
      reached = await pollUntil(
        () =>
          lastLine.evaluate((node) => {
            const box = node.getBoundingClientRect()
            return box.top >= -1 && box.bottom <= window.innerHeight + 1
          }),
        150,
      )
    }
    // Printed so the budget can be set from a measurement instead of a guess.
    // If this says "0", the file fitted on screen and no budget was needed.
    console.log(`measured rounds to reach the last line: ${reached ? rounds : 'NEVER'}`)
    expect(reached).toBe(true)
  })
})
