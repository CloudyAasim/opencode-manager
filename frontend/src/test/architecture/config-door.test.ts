import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

/**
 * The door the browser used to ask the configuration through.
 *
 * It answered with the document as it is written down, and the document holds
 * the credentials of every model provider on the host: four of them went into
 * the browser that way.
 */
const OLD_DOOR = '/api/settings/opencode-config'

/**
 * The door the browser asks now.
 */
const NEW_DOOR = '/api/bff/config'

const SRC_DIR = path.resolve(__dirname, '..', '..')

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
  walk(SRC_DIR)
  return found.sort()
}

describe('前端问配置的那扇门', () => {
  it('门禁自己看得见东西', () => {
    expect(browserSources().length, '一个前端源文件都没扫到，这条门禁正在空跑').toBeGreaterThan(10)
  })

  it('前端不许再问 manager 自己那扇门', () => {
    const offenders = browserSources()
      .filter((file) => fs.readFileSync(file, 'utf8').includes(OLD_DOOR))
      .map((file) => path.relative(SRC_DIR, file))
      .sort()

    expect(
      offenders,
      [
        `前端还在问 manager 自己那扇门：${offenders.join(', ')}`,
        '那扇门答的是整份配置，钥匙也在里面——四把密钥就是这么进的浏览器。',
        '前端要问这一层：这一层答的是遮过的那一份。',
      ].join('\n'),
    ).toEqual([])
  })

  it('前端问的是这一层', () => {
    const asking = browserSources()
      .filter((file) => fs.readFileSync(file, 'utf8').includes(NEW_DOOR))
      .map((file) => path.relative(SRC_DIR, file))
      .sort()

    // The gate above says the browser may not ask that door. It says nothing
    // about whether there is another one - so check that the browser really
    // does ask this layer, or the gate is guarding an empty room.
    expect(
      asking.length,
      '前端一处也没问这一层，那上面那条门禁只是在说一件没有发生的事',
    ).toBeGreaterThan(0)
  })
})
