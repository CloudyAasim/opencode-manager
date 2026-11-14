import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { repoRoot } from '../helpers/repo-root'

const BFF_DIR = path.join(repoRoot, 'backend/src/routes/bff')
const BFF_DOC = path.join(repoRoot, 'docs/api/bff.md')
const BFF_SHAPE_FILE = path.join(repoRoot, 'shared/src/api/bff.ts')
const FRONTEND_DIR = path.join(repoRoot, 'frontend/src')
const MOUNT = '/api/bff'

/**
 * The word an agent is called by. `opencode-manager` is the product and does
 * not count; `opencode` on its own is one backend, and a layer that mentions
 * it has stopped being a layer for every backend.
 */
const AGENT_WORD = /(?<![\w-])opencode(?![\w-])/i

function bffFiles(): string[] {
  return fs
    .readdirSync(BFF_DIR, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.ts'))
    .filter((entry) => !/\.(test|spec)\.ts$/.test(entry.name))
    .map((entry) => path.join(BFF_DIR, entry.name))
    .sort()
}

function read(file: string): string {
  return fs.readFileSync(file, 'utf8')
}

/**
 * Read a file that is allowed not to be there.
 *
 * The client's door to the agent is one of the doors that are being closed, so
 * the gates that watch it have to keep working on the day it is gone - and a
 * gate that throws when the file is missing is a gate that stops guarding.
 */
function readIfPresent(file: string): string {
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : ''
}

function importedNames(source: string): string[] {
  const names: string[] = []
  for (const match of source.matchAll(/import\s+(?:type\s+)?([^'"]*?)\s*from\s*['"][^'"]+['"]/g)) {
    const clause = match[1] ?? ''
    const braced = clause.match(/\{([\s\S]*)\}/)
    if (braced) {
      for (const piece of (braced[1] ?? '').split(',')) {
        const name = piece.trim().split(/\s+as\s+/).pop()?.trim()
        if (name) names.push(name)
      }
    }
    const defaultName = clause.replace(/\{[\s\S]*\}/, '').replace(/,/g, '').trim()
    if (defaultName) names.push(defaultName)
  }
  return names
}

function importSpecifiers(source: string): string[] {
  const specs: string[] = []
  for (const match of source.matchAll(/from\s*['"]([^'"]+)['"]/g)) specs.push(match[1]!)
  for (const match of source.matchAll(/import\(\s*['"]([^'"]+)['"]\s*\)/g)) specs.push(match[1]!)
  return specs
}

interface DeclaredRoute {
  method: string
  path: string
}

function declaredRoutes(): DeclaredRoute[] {
  const indexSource = read(path.join(BFF_DIR, 'index.ts'))
  const mounts = new Map<string, string>()
  for (const match of indexSource.matchAll(/app\.route\(\s*'([^']+)'\s*,\s*([A-Za-z0-9_]+)/g)) {
    mounts.set(match[2]!, match[1]!)
  }

  const routes: DeclaredRoute[] = []
  for (const file of bffFiles()) {
    const source = read(file)
    const factory = source.match(/export\s+function\s+([A-Za-z0-9_]+)/)?.[1]
    const prefix = factory ? (mounts.get(factory) ?? '') : ''
    for (const match of source.matchAll(/app\.(get|post|put|patch|delete)\(\s*'([^']*)'/g)) {
      const suffix = match[2] === '/' ? '' : match[2]
      routes.push({ method: match[1]!.toUpperCase(), path: `${MOUNT}${prefix}${suffix}` })
    }
  }
  return routes
}

function documentedRoutes(): DeclaredRoute[] {
  const doc = read(BFF_DOC)
  const routes: DeclaredRoute[] = []
  for (const row of doc.split('\n')) {
    if (!row.trimStart().startsWith('|')) continue
    const match = row.match(/^\|\s*`(GET|POST|PUT|PATCH|DELETE)`\s*\|\s*`([^`]+)`\s*\|/)
    if (match) routes.push({ method: match[1]!, path: match[2]! })
  }
  return routes
}

function key(route: DeclaredRoute): string {
  return `${route.method} ${route.path}`
}

function frontendSources(): string[] {
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

describe('给前端的那一层', () => {
  it('门禁自己看得见东西', () => {
    expect(bffFiles().length, 'routes/bff/ 下一个文件都没有了，这条门禁正在空跑').toBeGreaterThan(1)
    expect(declaredRoutes().length, '没从代码里读到任何 BFF 端点，这条门禁正在空跑').toBeGreaterThan(0)
    expect(documentedRoutes().length, 'docs/api/bff.md 里没扫到端点，这条门禁正在空跑').toBeGreaterThan(0)
  })

  it('BFF 路由不许认识任何一个具体的 agent', () => {
    const offenders: string[] = []
    for (const file of bffFiles()) {
      const source = read(file)
      const name = path.basename(file)

      for (const spec of importSpecifiers(source)) {
        if (spec.split('/').some((segment) => segment.toLowerCase() === 'opencode')) {
          offenders.push(`${name} 引入了 ${spec}`)
        }
      }
      for (const imported of importedNames(source)) {
        if (/opencode/i.test(imported)) {
          offenders.push(`${name} 引入了 ${imported}`)
        }
      }
      if (AGENT_WORD.test(source)) {
        offenders.push(`${name} 把某一个 agent 的名字写在了正文里`)
      }
    }

    expect(
      offenders,
      [
        `BFF 里有 ${offenders.length} 处知道了具体是谁在干活：`,
        ...offenders,
        '这一层是给前端用的，它得对所有后端说同一套话，否则换个后端前端就得跟着改。',
      ].join('\n'),
    ).toEqual([])
  })

  it('形状本身也不许认识任何一个具体的 agent', () => {
    const source = read(BFF_SHAPE_FILE)
    expect(
      AGENT_WORD.test(source),
      'shared/src/api/bff.ts 里出现了某一个 agent 的名字，形状就不再是所有后端共用的形状',
    ).toBe(false)
  })

  it('BFF 的每个响应都得先过形状', () => {
    const offenders = bffFiles()
      .filter((file) => /\bc\.json\(/.test(read(file)))
      .map((file) => path.basename(file))
      .sort()

    expect(
      offenders,
      [
        `这些文件自己写了响应：${offenders.join(', ')}`,
        '每个响应都要先过形状才能出门，否则形状只是一张纸。',
        '要发响应就调 respond.ts 里的 ok() 或 fail()。',
      ].join('\n'),
    ).toEqual([])
  })

  it('文档里的端点都得在代码里存在，代码里的端点也都得在文档里', () => {
    const declared = new Set(declaredRoutes().map(key))
    const documented = new Set(documentedRoutes().map(key))

    const missingInCode = [...documented].filter((entry) => !declared.has(entry)).sort()
    const missingInDoc = [...declared].filter((entry) => !documented.has(entry)).sort()

    expect(
      missingInCode,
      [
        `docs/api/bff.md 里的 ${missingInCode.length} 条端点在代码里不存在：`,
        ...missingInCode,
        '照文档写的客户端会拿到 404，而文档看起来仍然是权威的。',
      ].join('\n'),
    ).toEqual([])

    expect(
      missingInDoc,
      [
        `代码里的 ${missingInDoc.length} 条端点没有写进 docs/api/bff.md：`,
        ...missingInDoc,
        '一个没人写下来的端点，下一轮就会被当成不存在。',
      ].join('\n'),
    ).toEqual([])
  })

  it('前端不许再自己去问 agent 的会话列表', () => {
    // The list is the server's job: it merges the directories and keeps the
    // cursors. A client that does it itself has to know how to merge pages,
    // and every place that draws a list has to know that too.
    //
    // The names are what makes this checkable: a path is not enough, because
    // `GET /session` and `POST /session` are the same path and only one of
    // them is a list.
    const AGENT_CLIENT = path.join(FRONTEND_DIR, 'api', 'opencode.ts')
    const offenders: string[] = []

    for (const match of readIfPresent(AGENT_CLIENT).matchAll(/\basync\s+(listSessions(?:Page)?)\s*\(/g)) {
      offenders.push(`api/opencode.ts 定义了 ${match[1]}`)
    }
    for (const file of frontendSources()) {
      const source = read(file)
      for (const match of source.matchAll(/\basync\s+(listSessionsPage)\s*\(/g)) {
        offenders.push(`${path.relative(repoRoot, file)} 定义了 ${match[1]}`)
      }
    }

    expect(
      offenders,
      [
        `前端还在自己去问 agent 的会话列表：${offenders.join(', ')}`,
        '前端要问这一层，不要问 agent。',
        '自己问的话，合并和游标就散落在每个画列表的地方。',
      ].join('\n'),
    ).toEqual([])
  })

  it('前端不许再自己去问 agent 的待办列表', () => {
    // The same job as the session list: one answer for every working
    // directory, merged by the server. A client that asks the agent per
    // directory pays for two round trips per directory - and it holds the
    // agent's dialect, which is not the dialect the app keeps.
    const AGENT_CLIENT = path.join(FRONTEND_DIR, 'api', 'opencode.ts')
    const offenders: string[] = []

    for (const match of readIfPresent(AGENT_CLIENT).matchAll(/\basync\s+(listPending(?:Permissions|Questions))\s*\(/g)) {
      offenders.push(`api/opencode.ts 定义了 ${match[1]}`)
    }
    for (const file of frontendSources()) {
      const source = read(file)
      for (const match of source.matchAll(/\basync\s+(listPending(?:Permissions|Questions))\s*\(/g)) {
        offenders.push(`${path.relative(repoRoot, file)} 定义了 ${match[1]}`)
      }
    }

    expect(
      offenders,
      [
        `前端还在自己去问 agent 的待办列表：${offenders.join(', ')}`,
        '前端要问这一层，不要问 agent。',
        '自己问的话，每个目录都要问两次，而答案还得在浏览器里合。',
      ].join('\n'),
    ).toEqual([])
  })

  it('前端确实在问这一层', () => {
    const asking = frontendSources().filter((file) => read(file).includes('/api/bff/sessions'))
    expect(
      asking.length,
      '前端一处也没问这一层，那上面那条门禁就只是在说一件没有发生的事',
    ).toBeGreaterThan(0)

    const askingPending = frontendSources().filter((file) => read(file).includes('/api/bff/pending'))
    expect(
      askingPending.length,
      '前端一处也没问这一层的待办，那上面那条门禁同样在说一件没有发生的事',
    ).toBeGreaterThan(0)
  })

  it('前端不许再自己去问 agent 的会话级面', () => {
    // Creating, renaming, deleting and stopping a conversation are the
    // layer's job: it knows where the conversation lives and who asked for
    // it. A client that asks the agent itself has to know both, and it keeps
    // a map of conversations to directories that is wrong the moment a
    // conversation moves.
    //
    // The names are what makes this checkable: the layer's client has
    // methods of its own, so only the agent's client is looked at.
    const AGENT_CLIENT = path.join(FRONTEND_DIR, 'api', 'opencode.ts')
    const AGENT_ONLY = ['updateSession', 'deleteWorkspace']
    const offenders: string[] = []

    for (const match of readIfPresent(AGENT_CLIENT).matchAll(
      /\basync\s+(createSession|updateSession|deleteSession|deleteWorkspace|abortSession)\s*\(/g,
    )) {
      offenders.push(`api/opencode.ts 定义了 ${match[1]}`)
    }
    for (const file of frontendSources()) {
      const source = read(file)
      for (const match of source.matchAll(
        new RegExp(`\\basync\\s+(${AGENT_ONLY.join('|')})\\s*\\(`, 'g'),
      )) {
        offenders.push(`${path.relative(repoRoot, file)} 定义了 ${match[1]}`)
      }
    }

    expect(
      offenders,
      [
        `前端还在自己去问 agent 的会话级面：${offenders.join(', ')}`,
        '前端要问这一层，不要问 agent。',
        '自己问的话，客户端就得自己记着会话在哪个目录，还得自己记着这个会话是谁的。',
      ].join('\n'),
    ).toEqual([])
  })

  it('前端不许再自己去问 agent 的对话面', () => {
    // The conversation is this layer's job, for the same reason the list is:
    // the layer knows which agent is behind the conversation, where it lives
    // and whose it is. A client that asks the agent itself has to know all
    // three, and it keeps the agent's words while the layer answers in the
    // versioned ones - so one cache slot ends up holding two dialects of the
    // same conversation.
    //
    // The names are what makes this checkable: the layer's client has methods
    // of its own, so only the agent's client is looked at by name.
    const AGENT_CLIENT = path.join(FRONTEND_DIR, 'api', 'opencode.ts')
    const LAYER_CLIENT = path.join(FRONTEND_DIR, 'api', 'bff.ts')
    const AGENT_ONLY = [
      'getSession',
      'listMessages',
      'sendPrompt',
      'sendPromptAsync',
      'revertMessage',
      'unrevertSession',
      'getSessionStatuses',
      'respondToPermission',
      'replyToQuestion',
      'rejectQuestion',
    ]
    const offenders: string[] = []

    for (const match of readIfPresent(AGENT_CLIENT).matchAll(
      new RegExp(`\\basync\\s+(${AGENT_ONLY.join('|')})\\s*\\(`, 'g'),
    )) {
      offenders.push(`api/opencode.ts 定义了 ${match[1]}`)
    }
    for (const file of frontendSources()) {
      const source = read(file)
      for (const match of source.matchAll(
        new RegExp(`\\basync\\s+(${AGENT_ONLY.join('|')})\\s*\\(`, 'g'),
      )) {
        // The layer's own client is allowed to have these names: it is the
        // one the client is supposed to be talking to.
        if (file === LAYER_CLIENT) continue
        offenders.push(`${path.relative(repoRoot, file)} 定义了 ${match[1]}`)
      }
    }

    expect(
      offenders,
      [
        `前端还在自己去问 agent 的对话面：${offenders.join(', ')}`,
        '前端要问这一层，不要问 agent。',
        '自己问的话，同一个缓存格子会同时装两种方言：agent 的话和版本化的话。',
      ].join('\n'),
    ).toEqual([])

    // The gate above says the client may not ask the agent. It says nothing
    // about whether there is anything else to ask - so check that the layer's
    // client really does have the conversation, or the gate is guarding an
    // empty room.
    const layer = read(LAYER_CLIENT)
    for (const method of [
      'listMessages',
      'sendPrompt',
      'revertSession',
      'listStatuses',
      'respondToPermission',
      'replyToQuestion',
      'rejectQuestion',
    ]) {
      expect(layer, `这一层的客户端没有 ${method}`).toMatch(new RegExp(`\\basync\\s+${method}\\s*\\(`))
    }
  })

  it('前端不许再有问 agent 的那个客户端', () => {
    // The client that talked to the agent had a door for everything the agent
    // could be asked. Every one of those doors is the layer's now, so the
    // client itself is gone - and it must not come back, because a client
    // that exists is a client that will be used.
    //
    // The type file next to it is a different thing: it describes what the
    // agent's API looks like, and describing a door is not walking through
    // it. That one is still here, and it is here on purpose.
    const AGENT_CLIENT = path.join(FRONTEND_DIR, 'api', 'opencode.ts')
    const AGENT_TYPES = path.join(FRONTEND_DIR, 'api', 'opencode-types.ts')

    expect(
      fs.existsSync(AGENT_CLIENT),
      [
        '前端又有了一个问 agent 的客户端：api/opencode.ts',
        '这一层现在是前端唯一该问的门，问 agent 的那个客户端不该再存在。',
        '（api/opencode-types.ts 是另一回事：它描述 agent 的 API 长什么样，不是去问它。）',
      ].join('\n'),
    ).toBe(false)

    expect(
      fs.existsSync(AGENT_TYPES),
      'api/opencode-types.ts 不见了：还有形状没有搬过来，别把这个门禁当成搬完了',
    ).toBe(true)
  })

  it('前端不许再自己去问 agent 的那张面', () => {
    // The agent's own face - the commands it knows, the ways of working it can
    // be, the two defaults - is this layer's job, for the same reason the
    // conversation is: the layer knows which agent is behind it, and it says
    // it in the versioned dialect. A client that asks the agent itself holds
    // the agent's words, and the command palette it draws would be the
    // agent's rather than the app's.
    //
    // The names are what makes this checkable: the layer's client has methods
    // of its own, so only the agent's names are looked at, and only outside
    // the layer's client.
    const LAYER_CLIENT = path.join(FRONTEND_DIR, 'api', 'bff.ts')
    const AGENT_ONLY = [
      'listCommands',
      'sendCommand',
      'summarizeSession',
      'forkSession',
      'sendShell',
      'listAgents',
      'getConfig',
      'getEventSourceURL',
    ]
    const offenders: string[] = []

    for (const file of frontendSources()) {
      const source = read(file)
      for (const match of source.matchAll(
        new RegExp(`\\basync\\s+(${AGENT_ONLY.join('|')})\\s*\\(`, 'g'),
      )) {
        // The layer's own client is allowed to have these names: it is the
        // one the client is supposed to be talking to.
        if (file === LAYER_CLIENT) continue
        offenders.push(`${path.relative(repoRoot, file)} 定义了 ${match[1]}`)
      }
    }

    expect(
      offenders,
      [
        `前端还在自己去问 agent 的那张面：${offenders.join(', ')}`,
        '前端要问这一层，不要问 agent。',
        '自己问的话，命令面板画出来的是 agent 的样子，不是这一层的。',
      ].join('\n'),
    ).toEqual([])

    // The gate above says the client may not ask the agent. It says nothing
    // about whether there is anything else to ask - so check that the layer's
    // client really does have the agent's face, or the gate is guarding an
    // empty room.
    const layer = read(LAYER_CLIENT)
    for (const method of [
      'listCommands',
      'sendCommand',
      'summarizeSession',
      'forkSession',
      'sendShell',
      'listWorkingModes',
      'getDefaults',
    ]) {
      expect(layer, `这一层的客户端没有 ${method}`).toMatch(new RegExp(`\\basync\\s+${method}\\s*\\(`))
    }
  })

  it('前端不许自己去够 agent 的对话路径', () => {
    // The names of the methods are one way in; the paths are the other. A
    // client that builds the agent's conversation path by hand is asking the
    // agent about the conversation, whatever the method that does it is
    // called.
    //
    // The same is true of the paths that are not the conversation itself but
    // hang on it: how busy it is, and what it is waiting for. The layer says
    // those in the versioned dialect too, and a client that asked the agent
    // for them would be holding the agent's words beside the versioned ones.
    //
    // The agent's own type file is the one exception: it describes what the
    // agent's API looks like so the client can be written against it, and
    // describing a door is not walking through it.
    const AGENT_TYPES = path.join(FRONTEND_DIR, 'api', 'opencode-types.ts')
    const AGENT_CONVERSATION_PATH = /\/session\/[^`'"\s]*?\/(?:message|messages|prompt|prompt_async|revert)\b/g
    const AGENT_STATUS_PATH = /\/session\/status\b/g
    // The agent's waiting paths are singular and this layer's are plural -
    // "/permission/{id}/reply" is the agent's, "/permissions/{id}/reply" is
    // this layer's - and the difference is what keeps the two apart.
    const AGENT_WAITING_PATH = /\/(?:permission|question)\/[^`'"\s]*?\/(?:reply|reject)\b/g
    // The agent's own face has paths too: the commands it knows and the ways
    // of working it can be sit at the root of its API, and what hangs on a
    // conversation hangs on its conversation path - "/session/{id}/command" is
    // the agent's, "/sessions/{id}/commands" is this layer's.
    //
    // The two root paths are only counted when they are a whole quoted path,
    // because "/commands" is also the name of a directory in this app and
    // "/agent-colors" is a module.
    const AGENT_FACE_ROOT_PATH = /['"`]\/(?:command|agent)\b/g
    const AGENT_FACE_SESSION_PATH = /\/session\/[^`'"\s]*?\/(?:command|shell|fork|summarize)\b/g
    const offenders: string[] = []

    for (const file of frontendSources()) {
      if (file === AGENT_TYPES) continue
      const source = read(file)
      for (const pattern of [
        AGENT_CONVERSATION_PATH,
        AGENT_STATUS_PATH,
        AGENT_WAITING_PATH,
        AGENT_FACE_ROOT_PATH,
        AGENT_FACE_SESSION_PATH,
      ]) {
        for (const match of source.matchAll(pattern)) {
          offenders.push(`${path.relative(repoRoot, file)} 够到了 ${match[0]}`)
        }
      }
    }

    expect(
      offenders,
      [
        `前端还在自己去够 agent 的对话路径：${offenders.join(', ')}`,
        '前端要问这一层，不要问 agent。',
      ].join('\n'),
    ).toEqual([])
  })

  it('客户端不许把这一层的地址当成可有可无', () => {
    // 这一层的地址可以是空的。空串说的是「就是你打开这个页面的那个地方」，
    // 大多数部署住在那里，每一个装好的客户端也住在那里。把它读成「没有
    // 服务器」，挂在它下面的东西就会悄悄停掉——而页面看着还是好的，只是
    // 从此不再问，也没有任何东西说它不再问了。
    //
    // agent 的地址是另一回事：那个地址不会是空的，空了是真的没有人在。
    //
    // 例外只有一个文件：那里的空串说的是「这个人没有选过服务器」，那是
    // 一个选择，不是一个地址。
    const LAYER_ADDRESSES = ['serverUrl', 'API_BASE_URL']
    const EXCEPTION = path.join(FRONTEND_DIR, 'lib', 'server-selection.ts')
    const offenders: string[] = []

    for (const file of frontendSources()) {
      if (file === EXCEPTION) continue
      const source = read(file)
      for (const name of LAYER_ADDRESSES) {
        const patterns = [
          // `!serverUrl`, `!!serverUrl` - the address read as a yes/no.
          new RegExp(`!\\s*${name}\\b`, 'g'),
          // `serverUrl && ...` - the same question, asked the other way round.
          new RegExp(`\\b${name}\\s*&&`, 'g'),
          // A ternary, but not an optional property: `serverUrl?:` is a type.
          new RegExp(`\\b${name}\\s*\\?\\s*[^:\\s]`, 'g'),
        ]
        for (const pattern of patterns) {
          for (const match of source.matchAll(pattern)) {
            offenders.push(`${path.relative(repoRoot, file)} 写了 ${match[0].trim()}`)
          }
        }
      }
    }

    expect(
      offenders,
      [
        `前端把这一层的地址当成了可有可无：${offenders.join(', ')}`,
        '这一层的地址为空串时说的是「就是你打开这个页面的那个地方」，不是「没有服务器」。',
        '照这么写，挂在它下面的东西会悄悄停掉，页面却看着还是好的。',
      ].join('\n'),
    ).toEqual([])

    // The gate above says the address may not be read as a yes/no. It says
    // nothing about what a reader is supposed to find instead - so check
    // that the honest way of asking is there at all, or the gate is only
    // complaining about a shape nobody uses.
    const honest = frontendSources().filter((file) =>
      /serverUrl !== undefined && serverUrl !== null|hasLayerAddress\(/.test(read(file)),
    )
    expect(
      honest.length,
      '前端一处也没有诚实的写法，这条门禁正在空跑',
    ).toBeGreaterThan(0)
  })

  it('app 和测试必须住在同一个世界里', () => {
    // staleTime 是查询活着的那个世界的一部分：一个**被本地答了的**查询，
    // 在那段时间里看起来是新鲜的，而新鲜的查询不会再问一次。
    //
    // 命令列表就是这样被本地答了的——用内置命令——于是这一层一次也没被问过。
    // 而测试之所以没发现，是因为测试自己造了一个**没有** staleTime 的
    // QueryClient：那是另一个世界，app 在里面做的事它一件也看不见。
    //
    // 所以 app 的客户端得只有一份，测试也得用它。
    const FACTORY = path.join(FRONTEND_DIR, 'lib', 'queryClient.ts')
    const COMMAND_TEST = path.join(FRONTEND_DIR, 'hooks', 'useCommands.test.tsx')

    expect(
      fs.existsSync(FACTORY),
      [
        '前端的 query 客户端不在 lib/queryClient.ts 了。',
        '测试就没有同一个世界可以待——而 app 的 staleTime 正是命令列表没到的原因。',
      ].join('\n'),
    ).toBe(true)

    expect(
      read(path.join(FRONTEND_DIR, 'App.tsx')),
      [
        'App.tsx 自己造了一个 query 客户端。',
        '它和测试用的那份已经是两个世界了，而这两份的数字不一样的时候没人会发现。',
      ].join('\n'),
    ).toMatch(/createQueryClient\(\)/)

    expect(
      readIfPresent(COMMAND_TEST),
      '命令列表的测试没有用 app 的 query 客户端，它跑的世界和 app 不是同一个',
    ).toMatch(/createQueryClient\(\)/)
  })

  it('这一层必须把会话收窄到调用者', () => {
    // One conversation is as much a conversation as a list of them is: an
    // agent knows about conversations, not about people. Without this, one
    // conversation is handed to whoever asked for it.
    //
    // The commands, the shell, the copy and the summary are on the
    // conversation too - they hang on it - so they are held to the same rule.
    const withSession = bffFiles().filter((file) =>
      /\b(getSession|renameSession|deleteSession|abortSession|listMessages|sendPrompt|revertSession|respondToPermission|replyToQuestion|rejectQuestion|sendCommand|summarizeSession|forkSession|sendShell)\s*\(/.test(read(file)),
    )
    expect(withSession.length, '没找到出会话的地方，这条门禁正在空跑').toBeGreaterThan(0)

    const offenders = withSession
      .filter((file) => !/sessionVisibleTo|sessionBelongsToCaller/.test(read(file)))
      .map((file) => path.basename(file))
      .sort()

    expect(
      offenders,
      [
        `这些文件把会话原样交出去了：${offenders.join(', ')}`,
        '会话必须先按调用者收窄，不然它就是别人的会话。',
        '（收窄一个会话的是 sessionVisibleTo，不是收窄列表的那个。）',
      ].join('\n'),
    ).toEqual([])
  })

  it('这一层必须把列表收窄到调用者', () => {
    // An agent knows about conversations, not about people. Without this the
    // list is the whole server's list, and it is handed to whoever asked.
    const withList = bffFiles().filter((file) => /listSessions\s*\(/.test(read(file)))
    expect(withList.length, '没找到出会话列表的地方，这条门禁正在空跑').toBeGreaterThan(0)

    const offenders = withList
      .filter((file) => !/callerVisibleSessions|visibleSessions/.test(read(file)))
      .map((file) => path.basename(file))
      .sort()

    expect(
      offenders,
      [
        `这些文件把会话列表原样交出去了：${offenders.join(', ')}`,
        '列表必须先按调用者收窄，不然它就是整个服务器的列表。',
      ].join('\n'),
    ).toEqual([])
  })

  it('这一层必须把待办收窄到调用者', () => {
    // A pending request belongs to a conversation, so the conversation
    // decides whose it is. An agent knows about conversations, not people.
    const withPending = bffFiles().filter((file) => /listPending(?:Permissions|Questions)\s*\(/.test(read(file)))
    expect(withPending.length, '没找到出处待办的地方，这条门禁正在空跑').toBeGreaterThan(0)

    const offenders = withPending
      .filter((file) => !/callerVisiblePendingRequests/.test(read(file)))
      .map((file) => path.basename(file))
      .sort()

    expect(
      offenders,
      [
        `这些文件把待办原样交出去了：${offenders.join(', ')}`,
        '待办必须先按调用者收窄，不然它就是整个服务器的待办。',
      ].join('\n'),
    ).toEqual([])
  })
})
