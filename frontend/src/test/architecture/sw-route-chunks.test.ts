import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { LAZY_ROUTE_PAGE, readRouteChunkNames } from '../../../plugins/sw-precache-manifest'

const FRONTEND_ROOT = path.resolve(__dirname, '../../..')
const ROUTES = path.join(FRONTEND_ROOT, 'src/routes.tsx')
const PLUGIN = path.join(FRONTEND_ROOT, 'plugins/sw-precache-manifest.ts')

function routePages(): string[] {
  return [...fs.readFileSync(ROUTES, 'utf8').matchAll(LAZY_ROUTE_PAGE)].map((match) => match[1])
}

function render(title: string, offenders: string[]): string {
  if (offenders.length === 0) return `${title}: 0 处违规`
  return [`${title}: ${offenders.length} 处违规`, ...offenders.map((entry) => `  ${entry}`)].join('\n')
}

/**
 * The service worker decides what to precache during install by recognising
 * lazy route chunks. That set used to be a hand-written list beside the plugin.
 *
 * It had already drifted: `RepoDetail` and `AssistantRedirect` were still listed
 * after both routes were deleted, and `NotFound` and `OpenCodeSettings` were
 * missing after both routes were added. Nothing turned red, because the two
 * missing chunks happened to be under the small-asset limit and so reached the
 * same verdict by the fallback. That is the failure this gate exists to stop - a
 * precache decision that is correct by coincidence and stops being correct the
 * moment a chunk changes size.
 *
 * The set is now read out of `routes.tsx`, so what is left to protect is that
 * nobody reintroduces a second copy of the list and quietly takes the derivation
 * back out of the build. The parser itself is imported from the plugin rather
 * than restated here: a copy of it in this file would be a third place for the
 * rule to drift, and the check that they match would be checking itself.
 */
describe('service worker 的路由分块来源', () => {
  it('门禁自己看得见东西', () => {
    expect(routePages().length, '一条懒加载路由都没扫到，这条门禁正在空跑').toBeGreaterThan(5)
  })

  it('插件里不许再留一份手抄的路由清单', () => {
    const offenders = [...fs.readFileSync(PLUGIN, 'utf8').matchAll(/\bROUTE_CHUNK_NAMES\b/g)].map(
      () => 'plugins/sw-precache-manifest.ts 里又出现了 ROUTE_CHUNK_NAMES',
    )
    expect(
      offenders,
      render('插件里又出现了手抄的路由清单，它会和 routes.tsx 各走各的', offenders),
    ).toEqual([])
  })

  it('每个懒加载路由都真的有一个 pages 模块', () => {
    const missing = routePages()
      .filter((name) => !fs.existsSync(path.join(FRONTEND_ROOT, `src/pages/${name}.tsx`)))
      .sort()
    expect(missing, render('这些路由指向的 pages 模块不存在', missing)).toEqual([])
  })

  it('推导不出来时必须失败，而不是悄悄退回按体积猜', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sw-routes-'))
    try {
      fs.mkdirSync(path.join(root, 'src'))
      fs.writeFileSync(
        path.join(root, 'src/routes.tsx'),
        'export const appRoutes = [{ path: "/login", loader: async () => null }]\n',
      )
      await expect(readRouteChunkNames(root)).rejects.toThrow(/no lazy route pages/)
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  })

  it('推导真的认得出真实的路由表', async () => {
    const expected = [...new Set(routePages())].sort()
    const names = [...(await readRouteChunkNames(FRONTEND_ROOT))].sort()
    expect(names, '插件推导出的路由名与 routes.tsx 里的懒加载路由对不上').toEqual(expected)
    expect(names.length, '一条懒加载路由都没扫到，这条门禁正在空跑').toBeGreaterThan(5)
  })
})
