import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { appRoutes, pageModules, prefetchLoaders } from '@/routes'

function render(title: string, offenders: string[]): string {
  if (offenders.length === 0) return `${title}: 0 处问题`
  return [`${title}: ${offenders.length} 处问题`, ...offenders.map((entry) => `  ${entry}`)].join('\n')
}

describe('路由清单', () => {
  it('路径唯一', () => {
    const seen = new Map<string, number>()
    const duplicates: string[] = []
    for (const route of appRoutes) {
      const path = route.path ?? ''
      if (seen.has(path)) duplicates.push(`${path} 出现于第 ${seen.get(path)} 与第 ${seen.size + 1} 条`)
      seen.set(path, seen.size + 1)
    }
    expect(duplicates, render('重复路径', duplicates)).toEqual([])
  })

  it('预取优先级唯一且连续', () => {
    const orders = appRoutes
      .map((route) => route.prefetch?.order)
      .filter((order): order is number => order !== undefined)
      .sort((left, right) => left - right)
    const gaps: string[] = []
    orders.forEach((order, index) => {
      if (order !== index + 1) gaps.push(`第 ${index + 1} 位期望 ${index + 1}，实际 ${order}`)
    })
    expect(gaps, render('预取优先级', gaps)).toEqual([])
    expect(new Set(orders).size, render('预取优先级唯一性', [])).toBe(orders.length)
  })

  it('登录前页面不参与预取', () => {
    const publicPaths = ['/login', '/register', '/setup']
    const warmed = appRoutes.filter((route) => route.prefetch).map((route) => route.path)
    const leaked = publicPaths.filter((path) => warmed.includes(path))
    expect(leaked, render('公开页被预取', leaked)).toEqual([])
  })

  it('已登录预取 8 个 chunk，管理员再加 2 个', () => {
    expect(prefetchLoaders(['authenticated'])).toHaveLength(8)
    expect(prefetchLoaders(['authenticated', 'admin'])).toHaveLength(10)
    expect(prefetchLoaders(['admin'])).toHaveLength(2)
  })

  it('OpenCode 配置页只在管理员那一组里预取', () => {
    const page = appRoutes.find((route) => route.path === '/settings/opencode')
    expect(page?.prefetch?.group).toBe('admin')
    // A tenant must never download the chunk that edits the document every
    // session on the server reads, even though the route would refuse them.
  })

  it('管理员的终端页排在已登录页面之后', () => {
    const terminal = appRoutes.find((route) => route.path === '/terminal')
    expect(terminal?.prefetch?.order).toBe(9)
  })
})

/**
 * A page switch used to leave the previous page on screen until the new
 * page's chunk had travelled the network, because the router waits for a
 * route's own `lazy` before it renders that route.
 *
 * The pages are loaded through `React.lazy` now, so the route is handed
 * to React as soon as it is chosen and the shell shows a loading state
 * while the chunk is on its way.
 *
 * The router's `lazy` is what put the wait there, so it is what has to
 * stay away: putting it back would bring the wait back with it, and
 * nothing else would notice.
 */
describe('路由不挡住切页', () => {
  it('不用路由器自己的 lazy', () => {
    // Checked on the route objects rather than on the source text: the
    // router's `lazy` is the thing that waits for the network, and where
    // it is written in the file is not what makes it dangerous.
    const withLazy = appRoutes
      .filter((route) => typeof route.lazy === 'function')
      .map((route) => route.path ?? '(no path)')
    expect(withLazy, `这些路由用了路由器自己的 lazy：${withLazy.join(', ')}`).toEqual([])
  })

  it('每个路由都给了 element，所以一被选中就能渲染', () => {
    const missing = appRoutes
      .filter((route) => !route.element)
      .map((route) => route.path ?? '(no path)')
    expect(missing, `这些路由没有 element：${missing.join(', ')}`).toEqual([])
  })

  it('每个要预取的路由都带着自己的块', () => {
    const missing = appRoutes
      .filter((route) => route.prefetch && typeof route.prefetchLoad !== 'function')
      .map((route) => route.path ?? '(no path)')
    expect(missing, `这些路由要预取却没有块：${missing.join(', ')}`).toEqual([])
  })

  it('内容区有 Suspense 兜底', () => {
    // Without a boundary, a page whose code is still on its way leaves
    // the previous page on screen - which is the thing being fixed.
    const app = fs.readFileSync(path.resolve(__dirname, '../../App.tsx'), 'utf-8')
    expect(app).toMatch(/<Suspense[\s\S]*?<Outlet \/>[\s\S]*?<\/Suspense>/)
    expect(app).toContain('RouteLoading')
  })

  it('预取的块和路由自己用的是同一个', () => {
    // Warming a chunk the route will not use is bandwidth spent for
    // nothing, and warming it twice is the same chunk downloaded twice.
    const wrong = appRoutes
      .filter((route) => route.prefetch && route.page)
      .filter((route) => route.prefetchLoad !== pageModules[route.page!])
      .map((route) => route.path ?? '(no path)')
    expect(wrong, '这些路由预取的块不是自己要用的').toEqual([])
  })
})
