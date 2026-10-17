import { describe, expect, it } from 'vitest'
import { appWindowOptions, isAllowedNavigation, isExternallyOpenable, loadUrlFor } from './window.ts'

const ORIGIN = 'http://127.0.0.1:53124'

describe('窗口加载哪个地址', () => {
  it('永远加载代理，不加载服务器', () => {
    // The proxy origin and the server origin are different on purpose. A window
    // pointed at the server would work on a machine that happens to have a
    // reverse proxy in front and fail everywhere else, which is the least
    // diagnosable version of this bug.
    expect(loadUrlFor({ address: '127.0.0.1', port: 53124 })).toBe(`${ORIGIN}/`)
  })

  it('通配监听地址换成真正能连的那个', () => {
    // node reports `::` for a dual-stack listener. Handing the renderer
    // `http://[::]:1234/` is not an address anything can connect to.
    expect(loadUrlFor({ address: '::', port: 1234 })).toBe('http://127.0.0.1:1234/')
    expect(loadUrlFor({ address: '0.0.0.0', port: 1234 })).toBe('http://127.0.0.1:1234/')
  })
})

describe('窗口允许导航到哪里', () => {
  it('同源的任何路径都允许', () => {
    expect(isAllowedNavigation(`${ORIGIN}/settings`, ORIGIN)).toBe(true)
    expect(isAllowedNavigation(`${ORIGIN}/api/health`, ORIGIN)).toBe(true)
    expect(isAllowedNavigation(`${ORIGIN}/`, ORIGIN)).toBe(true)
  })

  it('别处一律拦下', () => {
    const elsewhere = [
      'https://example.com/',
      'https://evil.example/phish',
      // a different port on the same host is a different origin
      'http://127.0.0.1:9999/',
      // and so is a different scheme on the same host
      'https://127.0.0.1:53124/',
    ]
    for (const url of elsewhere) {
      expect(isAllowedNavigation(url, ORIGIN), `${url} 应该被拦下`).toBe(false)
    }
  })

  it('本地文件与脚本一律拦下', () => {
    // A file:// document in this window would read local files with the
    // renderer's privileges; javascript: has no business being navigated to at
    // all.
    for (const url of ['file:///etc/passwd', 'file:///C:/Users/x/.ssh/id_rsa', 'javascript:alert(1)', 'data:text/html,<script>1</script>']) {
      expect(isAllowedNavigation(url, ORIGIN), `${url} 应该被拦下`).toBe(false)
    }
  })

  it('拦不下一个解析不了的地址，所以先解析再比', () => {
    for (const junk of ['', 'not a url', '//', 'null', '%%%']) {
      expect(isAllowedNavigation(junk, ORIGIN), `${JSON.stringify(junk)} 应该被拦下`).toBe(false)
    }
  })

  it('允许名单本身是空的（代理还没起来）时，什么都不放行', () => {
    // Failing closed: with no origin to compare against, an equality test
    // against '' must not be reachable by anything.
    expect(isAllowedNavigation('http://127.0.0.1:1/', '')).toBe(false)
    expect(isAllowedNavigation(`${ORIGIN}/`, '')).toBe(false)
  })
})

describe('窗口的渲染进程设置', () => {
  it('不给页面 Node，也不关掉同源策略', () => {
    const { webPreferences } = appWindowOptions()
    // The renderer displays an app whose server can run code on this machine.
    // contextIsolation off, or nodeIntegration on, turns any injection in the
    // page into local code execution.
    expect(webPreferences.contextIsolation).toBe(true)
    expect(webPreferences.nodeIntegration).toBe(false)
    expect(webPreferences.sandbox).toBe(true)
    expect(webPreferences.webSecurity).toBe(true)
  })

  it('先藏起来，ready-to-show 再显示', () => {
    // Showing immediately means a white flash on every launch while the
    // stylesheet loads.
    expect(appWindowOptions().show).toBe(false)
  })
})

/**
 * `shell.openExternal` hands the URL to the operating system, which launches it
 * with whatever handler is registered. That is a different question from "may
 * this open in our window", and the answer to it is much narrower.
 *
 * These URLs reached the call because they are not ours - the very reason the
 * external open exists - and before the guard, `file://` and every registered
 * scheme handler went straight through.
 */
describe('什么可以交给操作系统打开', () => {
  it('http 与 https 交给浏览器处理', () => {
    for (const url of ['https://example.com/docs', 'http://example.com', 'https://example.com:8443/a?b=c']) {
      expect(isExternallyOpenable(url), `${url} 应该放行`).toBe(true)
    }
  })

  it('本地文件一律不交给操作系统', () => {
    // The OS will open these with whatever the user has registered, and on
    // some systems that is a program rather than a document viewer.
    for (const url of ['file:///etc/passwd', 'file:///C:/Users/x/.ssh/id_rsa', 'file://server/share']) {
      expect(isExternallyOpenable(url), `${url} 应该被拦下`).toBe(false)
    }
  })

  it('已注册的协议处理器一律不交给操作系统', () => {
    for (const url of ['javascript:alert(1)', 'data:text/html,<script>1</script>', 'smb://host/share',
                       'steam://run/440', 'ms-msdt://id', 'intent://scan#Intent;scheme=zxing;end']) {
      expect(isExternallyOpenable(url), `${url} 应该被拦下`).toBe(false)
    }
  })

  it('大小写与空白骗不过去', () => {
    // URL parsing lowercases the scheme, so 'FiLe:' cannot slip past a
    // comparison written against the lowercase literal.
    for (const url of ['FiLe:///etc/passwd', '  file:///etc/passwd', 'FILE:///etc/passwd']) {
      expect(isExternallyOpenable(url), `${url} 应该被拦下`).toBe(false)
    }
  })

  it('解析不了的地址一律不交给操作系统', () => {
    for (const junk of ['', 'not a url', '//', '%%%', 'example.com']) {
      expect(isExternallyOpenable(junk), `${JSON.stringify(junk)} 应该被拦下`).toBe(false)
    }
  })
})
