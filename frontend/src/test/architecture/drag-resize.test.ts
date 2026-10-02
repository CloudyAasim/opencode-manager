import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { buildImportGraph, relativeTo } from './import-graph'

const FRONTEND_SRC = path.resolve(__dirname, '../..')

const graph = buildImportGraph(FRONTEND_SRC, [['@', FRONTEND_SRC]])
const SOURCES = graph.files.map((file) => ({
  rel: relativeTo(graph, file),
  text: fs.readFileSync(file, 'utf8'),
}))

// A drag is recognised by listening for movement and for the end of the
// gesture. Registering both by hand is the thing this gate exists to stop.
const DRAG_LISTENER = /addEventListener\(\s*'mousemove'/
const END_LISTENER = /addEventListener\(\s*'(mouseup|touchend)'/
const ALLOWED = 'framework/shell/useDragResize.ts'

function handRolledDrags(): string[] {
  return SOURCES.filter(
    (source) => source.rel !== ALLOWED && DRAG_LISTENER.test(source.text) && END_LISTENER.test(source.text),
  ).map((source) => source.rel)
}

describe('拖拽只有一份实现', () => {
  it('门禁看得见当年那四份手搓实现', () => {
    expect(SOURCES.length, '源码没扫到，等于什么都没看').toBeGreaterThan(200)
    expect(
      SOURCES.filter((source) => DRAG_LISTENER.test(source.text) || END_LISTENER.test(source.text)).length,
      '一份 mousemove/mouseup 都没扫到，规则本身可能已经过期',
    ).toBeGreaterThan(0)
  })

  it('框架外不再自己注册拖拽监听', () => {
    const offenders = handRolledDrags()
    expect(
      offenders,
      [
        `这些文件自己注册了 mousemove + mouseup/touchend：${offenders.length} 处`,
        ...offenders,
        '拖动分隔条请用 framework/shell/useDragResize。',
        '手搓的代价不是代码长：三处漏了 user-select 锁，拖一下会选中一片文字；',
        '还有两处只认鼠标，触屏上根本拖不动。',
      ].join('\n'),
    ).toEqual([])
  })

  it('拖拽原语自己同时管鼠标和触摸', () => {
    const source = SOURCES.find((entry) => entry.rel === ALLOWED)
    expect(source, `找不到 ${ALLOWED}`).toBeDefined()
    const text = source!.text
    // Both halves matter: a cleanup line mentions the same event name as the
    // registration it undoes, so checking for the name alone proves nothing.
    for (const event of ['mousemove', 'mouseup', 'touchmove', 'touchend']) {
      expect(text, `${ALLOWED} 没有 addEventListener('${event}')`).toMatch(
        new RegExp(`addEventListener\\('${event}'`),
      )
      expect(text, `${ALLOWED} 没有 removeEventListener('${event}')`).toMatch(
        new RegExp(`removeEventListener\\('${event}'`),
      )
    }
    expect(text, '拖动时必须把文本选中锁上').toMatch(/userSelect\s*=\s*'none'/)
    expect(text, '拖动时必须给出光标反馈').toMatch(/cursor\s*=\s*'col-resize'/)
  })
})
