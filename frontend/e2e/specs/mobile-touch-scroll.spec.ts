import { test, expect, type Locator, type Page, type CDPSession } from '@playwright/test'
import { installApiMocks, makeSession } from '../helpers/api-mocks'

const REPO = { id: 1, fullPath: '/workspace/repos/demo', localPath: 'demo', cloneStatus: 'ready' as const }

type Listing = Array<{ name: string; isDirectory: boolean }>

/** Tall enough that it cannot fit any box it is put in. */
function listing(count: number): Listing {
  return Array.from({ length: count }, (_, index) => ({
    name: `file-${String(index).padStart(3, '0')}.ts`,
    isDirectory: false,
  }))
}

// 400 rows is about 13,700px of content behind a ~750px box, which is the
// shape of the listing that could not be scrolled on a phone.
const TALL = listing(400)
// Shorter for the reach test, which has to drag all the way down: the claim
// under test is that the listing scrolls, not how far it scrolls.
const REACHABLE = listing(150)

function directory(children: Listing) {
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
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(payload),
    }),
  )
}

const DRAG_STEPS = 8
const DRAG_STEP_MS = 8
const FLICK = 800

/**
 * A finger on the listing, wired up once per test.
 *
 * Setting `scrollTop` directly proves the box can hold a scroll offset, which
 * says nothing about whether a finger can produce one. A sheet that grows to
 * its content and is then clipped by an `overflow: hidden` ancestor passes
 * every `scrollTop = ...` assertion in the suite while being unusable on a
 * phone. This goes through CDP, which is the same path a touch takes.
 */
async function fingerOn(page: Page) {
  const client = (await page.context().newCDPSession(page)) as CDPSession
  const box = await page.locator('[data-testid="file-list-scroller"]').boundingBox()
  if (!box) throw new Error('the file list scroller has no box')

  const viewportHeight = await page.evaluate(() => window.innerHeight)
  const x = Math.round(box.x + box.width / 2)
  // `boundingBox()` is a plain {x, y, width, height}; there is no `bottom` on
  // it, and reading one yields NaN, which CDP rejects as invalid parameters.
  const startY = Math.min(viewportHeight - 4, Math.round(box.y + box.height - 40))

  return {
    async drag(distance: number) {
      const endY = Math.max(4, startY - distance)
      await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y: startY, id: 1 }] })
      for (let step = 1; step <= DRAG_STEPS; step += 1) {
        const y = Math.round(startY + ((endY - startY) * step) / DRAG_STEPS)
        await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y, id: 1 }] })
        // A finger has a timeline. Moves dispatched inside a single frame are
        // free to be coalesced into nothing at all.
        await page.waitForTimeout(DRAG_STEP_MS)
      }
      await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    },
    async release() {
      await client.detach()
    },
  }
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
 * Is the listing scrolled all the way to its end?
 *
 * The `limit > 0` half is load-bearing. A listing that has been clipped
 * instead of scrolled fills its box exactly, so `scrollTop` is `0` and
 * `scrollHeight - clientHeight` is `0`, and the comparison alone reports a box
 * that never moved as being at its bottom. The bottom of a listing that does
 * not scroll is not the bottom of the listing.
 */
const isAtBottom = (scroller: Locator) =>
  scroller.evaluate((node) => {
    const limit = node.scrollHeight - node.clientHeight
    return limit > 0 && node.scrollTop >= limit - 2
  })

/**
 * Is the row on the screen, inside the box that scrolls?
 *
 * The window check is not enough on desktop, where the listing shares the
 * sheet with a preview pane: a row can sit inside the viewport and still be
 * hidden behind something the user cannot see.
 *
 * Only call this for a row that has been rendered. On a virtualised listing an
 * unrendered row is not off screen, it does not exist yet, and asking about it
 * blocks until the test times out.
 */
function rowInsideScroller(row: Locator): Promise<boolean> {
  return row.evaluate((node) => {
    const clip = document.querySelector('[data-testid="file-list-scroller"]')
    if (!clip) return false
    const item = node.getBoundingClientRect()
    const box = clip.getBoundingClientRect()
    return item.top >= box.top - 1 && item.bottom <= box.bottom + 1
  })
}

/**
 * Drag until the listing moves, up to a budget.
 *
 * The budget bounds flakiness, not judgement. A sheet that is clipped instead
 * of scrolled has nothing to scroll: its box grows to the full height of the
 * listing, so `scrollHeight` equals `clientHeight` and no number of fingers
 * moves it. The budget cannot turn a broken sheet into a pass; it only stops a
 * loaded machine from failing a sheet that does work.
 */
async function dragUntilMoved(finger: Awaited<ReturnType<typeof fingerOn>>, scroller: Locator, attempts: number) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    await finger.drag(FLICK)
    if (await pollUntil(async () => (await scrollTopOf(scroller)) > 0, 1500)) return true
  }
  return false
}

async function openRepoFileBrowser(page: Page, files: Listing) {
  await installApiMocks(page, {
    repos: [REPO],
    sessionsByDirectory: { [REPO.fullPath]: [makeSession('ses_files', REPO.fullPath)] },
  })
  await mockListing(page, directory(files))

  await page.goto('/repos/1/sessions/ses_files?dialog=files')
  const scroller = page.locator('[data-testid="file-list-scroller"]')
  await expect(scroller).toBeVisible()
  await expect(scroller).toContainText('file-000.ts')
  return scroller
}

test.describe('the file browser sheet', () => {
  test('the list scrolls inside its own box instead of growing past the sheet', async ({ page }) => {
    const scroller = await openRepoFileBrowser(page, TALL)

    const metrics = await scroller.evaluate((node) => ({
      clientHeight: node.clientHeight,
      scrollHeight: node.scrollHeight,
      top: Math.round(node.getBoundingClientRect().top),
      bottom: Math.round(node.getBoundingClientRect().bottom),
      viewport: window.innerHeight,
    }))

    // A list that fits inside the box it lives in is not scrollable, so a long
    // listing has to overflow it.
    expect(metrics.scrollHeight).toBeGreaterThan(metrics.clientHeight)
    // And the box itself has to stay inside the sheet rather than run past it.
    expect(metrics.top).toBeGreaterThanOrEqual(0)
    expect(metrics.bottom).toBeLessThanOrEqual(metrics.viewport + 2)
  })

  test('a finger drags the listing in the sheet', async ({ page }) => {
    const scroller = await openRepoFileBrowser(page, TALL)
    const finger = await fingerOn(page)

    try {
      expect(await scrollTopOf(scroller)).toBe(0)
      expect(await dragUntilMoved(finger, scroller, 3)).toBe(true)
    } finally {
      await finger.release()
    }
  })

  test('the whole listing in the sheet stays reachable by touch', async ({ page }) => {
    const scroller = await openRepoFileBrowser(page, REACHABLE)
    const finger = await fingerOn(page)

    try {
      // One flick covers most of the way down a phone screen, so this listing
      // needs about six of them. The budget is twice that: what makes the
      // assertion pass is the sheet scrolling, not the budget running out.
      // How far a single flick actually travels depends on the fling, and the
      // fling is not ours to predict, so drag until it is at the end rather
      // than a fixed number of times.
      let bottomed = false
      for (let round = 0; round < 12 && !bottomed; round += 1) {
        await finger.drag(FLICK)
        bottomed = await pollUntil(() => isAtBottom(scroller), 150)
      }

      // Containment is not enough. When the sheet is clipped rather than
      // scrolled, every row is still in the document and `toContainText` passes
      // while the last one sits below the fold where nobody can see it. What
      // has to hold is that the row is on the screen.
      expect(bottomed).toBe(true)

      const lastRow = page.locator('[data-tree-row="file-149.ts"]')
      await expect(lastRow).toBeVisible()
      expect(await rowInsideScroller(lastRow)).toBe(true)
    } finally {
      await finger.release()
    }
  })
})

test.describe('the standalone files page', () => {
  test('a finger drags the listing', async ({ page }) => {
    await installApiMocks(page, { repos: [REPO] })
    await mockListing(page, directory(TALL))

    await page.goto('/files')
    const scroller = page.locator('[data-testid="file-list-scroller"]')
    await expect(scroller).toBeVisible()
    await expect(scroller).toContainText('file-000.ts')

    const finger = await fingerOn(page)
    try {
      expect(await scrollTopOf(scroller)).toBe(0)
      expect(await dragUntilMoved(finger, scroller, 3)).toBe(true)
    } finally {
      await finger.release()
    }
  })
})
