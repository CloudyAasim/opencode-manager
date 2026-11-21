import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { repoRoot } from '../helpers/repo-root'

const FRONTEND_DIR = path.join(repoRoot, 'frontend/src')
const ROUTES_DIR = path.join(repoRoot, 'backend/src/routes')
const BFF_DIR = path.join(ROUTES_DIR, 'bff')
const BFF_CONFIG_ROUTE = path.join(BFF_DIR, 'config.ts')
const INTERNAL_INDEX = path.join(ROUTES_DIR, 'internal', 'index.ts')
const MANAGER_CONFIG_ROUTE = path.join(ROUTES_DIR, 'opencode-config.ts')

/**
 * The door the browser used to ask the configuration through.
 *
 * It answered with the document as it is written down, and the document holds
 * the credentials of every model provider on the host: four of them went into
 * the browser that way, on a server with four providers.
 */
const OLD_DOOR = '/api/settings/opencode-config'

/**
 * The door the browser asks now.
 */
const NEW_DOOR = '/api/bff/config'

function read(file: string): string {
  return fs.readFileSync(file, 'utf8')
}

/**
 * The browser's own sources - the ones that run in the app.
 *
 * The tests are left out on purpose: a test that names a door is talking
 * about it, not walking through it.
 */
function browserSources(): string[] {
  const found: string[] = []
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        walk(full)
      } else if (/\.(ts|tsx)$/.test(entry.name) && !/\.(test|spec)\.tsx?$/.test(entry.name)) {
        found.push(full)
      }
    }
  }
  walk(FRONTEND_DIR)
  return found.sort()
}

/**
 * Every route file, the layer's own included.
 */
function routeFiles(): string[] {
  const found: string[] = []
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        walk(full)
      } else if (/\.ts$/.test(entry.name) && !/\.(test|spec)\.ts$/.test(entry.name)) {
        found.push(full)
      }
    }
  }
  walk(ROUTES_DIR)
  return found.sort()
}

/**
 * Where the manager's own configuration route is mounted.
 *
 * It is the route that answers with the whole document, keys and all, so
 * where it hangs is the whole question: a door the browser can reach is a
 * door that gives the keys away.
 */
function mountsOfTheManagerRoute(): string[] {
  const mounts: string[] = []
  for (const file of routeFiles()) {
    const source = read(file)
    // The file that *defines* the factory is not a place the door hangs - it is
    // the door itself. What matters is where somebody calls it, so the
    // definition is skipped and only the call sites are counted.
    if (/export\s+function\s+createOpenCodeConfigRoutes\b/.test(source)) continue
    if (source.includes('createOpenCodeConfigRoutes')) {
      mounts.push(path.relative(repoRoot, file))
    }
  }
  return mounts.sort()
}

describe('那张配置的门', () => {
  it('门禁自己看得见东西', () => {
    expect(fs.existsSync(MANAGER_CONFIG_ROUTE), 'manager 那扇门不见了，这条门禁正在空跑').toBe(true)
    expect(fs.existsSync(INTERNAL_INDEX), 'internal 那一层不见了，这条门禁正在空跑').toBe(true)
    expect(fs.existsSync(BFF_CONFIG_ROUTE), '这一层的那扇门不见了，这条门禁正在空跑').toBe(true)
    expect(browserSources().length, '一个前端源文件都没扫到，这条门禁正在空跑').toBeGreaterThan(10)

    const route = read(BFF_CONFIG_ROUTE)
    expect(route, '这一层没有 GET 那扇门').toMatch(/app\.get\('\/'/)
    expect(route, '这一层没有 PUT 那扇门').toMatch(/app\.put\('\/'/)
    expect(route, '这一层没有 agent 自己说的那份').toMatch(/app\.get\('\/effective'/)
  })

  it('manager 那扇门不再对着浏览器', () => {
    const mounts = mountsOfTheManagerRoute()

    // The internal door is where the agent's own plugin asks, and it is
    // behind a bearer token - not a door a browser walks into.
    expect(
      mounts,
      [
        `manager 那扇门现在挂在：${mounts.join(', ')}`,
        '它答的是整份配置，钥匙也在里面，所以它只能挂在 internal 那一层。',
        '浏览器要走这一层：这一层答的是遮过的那一份。',
      ].join('\n'),
    ).toEqual([path.relative(repoRoot, INTERNAL_INDEX)])
  })

  it('这一层不许自己读那份文件', () => {
    // The layer that answers the browser hands out the masked document; the
    // file itself is read by the service that knows how to mask it and how to
    // put the keys back. A layer that read the file itself would be one step
    // away from answering with the keys.
    const offenders: string[] = []
    for (const file of fs.readdirSync(BFF_DIR)) {
      if (!file.endsWith('.ts') || file.endsWith('.test.ts')) continue
      const source = read(path.join(BFF_DIR, file))
      for (const match of source.matchAll(/from\s*'([^']+)'/g)) {
        if (match[1]!.includes('opencode-config-file')) {
          offenders.push(`${file} 引入了 ${match[1]}`)
        }
      }
    }

    expect(
      offenders,
      [
        `这一层里有 ${offenders.length} 处自己去读了那份文件：`,
        ...offenders,
        '那份文件里有每一台机器上每一个模型的钥匙。',
        '这一层要的是遮过的那一份，去问服务要。',
      ].join('\n'),
    ).toEqual([])
  })

  it('前端不许再问 manager 那扇门', () => {
    const offenders: string[] = []
    for (const file of browserSources()) {
      if (read(file).includes(OLD_DOOR)) {
        offenders.push(path.relative(repoRoot, file))
      }
    }

    expect(
      offenders,
      [
        `前端还在问 manager 自己那扇门：${offenders.join(', ')}`,
        '那扇门答的是整份配置，钥匙也在里面。',
        '前端要问这一层。',
      ].join('\n'),
    ).toEqual([])
  })

  it('前端问的是这一层', () => {
    const asking = browserSources().filter((file) => read(file).includes(NEW_DOOR))

    // The gate above says the browser may not ask that door. It says nothing
    // about whether there is another one - so check that the browser really
    // does ask this layer, or the gate is guarding an empty room.
    expect(
      asking.length,
      '前端一处也没问这一层，那上面那条门禁只是在说一件没有发生的事',
    ).toBeGreaterThan(0)
  })
})
