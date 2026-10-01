import { describe, expect, it } from 'vitest'
import { appRoutes, prefetchLoaders } from '@/routes'

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

  it('已登录预取 8 个 chunk，管理员再加 1 个', () => {
    expect(prefetchLoaders(['authenticated'])).toHaveLength(8)
    expect(prefetchLoaders(['authenticated', 'admin'])).toHaveLength(9)
    expect(prefetchLoaders(['admin'])).toHaveLength(1)
  })

  it('管理员的终端页排在已登录页面之后', () => {
    const terminal = appRoutes.find((route) => route.path === '/terminal')
    expect(terminal?.prefetch?.order).toBe(9)
  })
})
