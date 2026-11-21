import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { buildImportGraph, relativeTo } from './import-graph'
import { stripComments } from './source-text'

const FRONTEND_SRC = path.resolve(__dirname, '../..')
const graph = buildImportGraph(FRONTEND_SRC, [['@', FRONTEND_SRC]])

/**
 * Where the catalogue of models may be searched.
 *
 * The catalogue is the layer's answer, in the layer's shape. A client that
 * keeps its own copy of that shape ends up answering questions about models
 * with a shape that may be out of date - and it did: the check that asks
 * whether a picked model is still available looked the model up in a
 * dictionary, while the catalogue's models are a list. The answer was always
 * "no", and every prompt sent with a model was refused.
 *
 * So the catalogue has an owner, and the two questions about it - which
 * provider is this, and is this model in it - are asked in one place each.
 */
const CATALOGUE = 'api/providers.ts'

/** This gate itself. It writes down the patterns it looks for. */
const SELF = 'test/architecture/model-catalogue.test.ts'

/** A search over a list of models. */
const MODEL_SEARCH = /\.models\s*\.\s*(?:find|some|filter)\s*\(/g

/** A search over a list of providers. */
const PROVIDER_SEARCH = /[Pp]roviders?[A-Za-z0-9_$]*\s*(?:\?)?\s*\.\s*(?:find|some)\s*\(/g

/** A search over a parenthesised list of providers. */
const PARENTHESISED_PROVIDER_SEARCH = /\([^()]*[Pp]roviders[^()]*\)\s*\.\s*(?:find|some)\s*\(/g

/**
 * The dictionary way of asking: is this name in that list?
 *
 * It is the way the catalogue was asked for a while, and it never finds
 * anything - a list of models answers to its own indexes, not to the names of
 * the models in it.
 */
const DICTIONARY_SEARCH = /[\w$)\]]\s+in\s+[\w$.]*\.models\b/g

/**
 * A search that finds something by its name.
 *
 * Only a search that compares the element's own id counts. Listing the models
 * of a provider is a different question - one this layer does not answer with
 * a lookup, and one that has nothing to do with whether a model is still
 * there.
 */
const COMPARES_ID = /\.\s*id\s*===|===\s*[^=]*\.\s*id/

interface Offender {
  rel: string
  line: number
  kind: string
  snippet: string
}

/**
 * The type written between the angle brackets, nested brackets and all.
 *
 * A type like `{ providers: Array<{ id: string; models: Record<string, unknown> }> }`
 * has three of them inside each other, so the end is found by counting rather
 * than by looking for the next `>`.
 */
function typeArgumentOf(text: string, openBracket: number): string {
  let depth = 0
  for (let i = openBracket; i < text.length; i++) {
    const character = text[i]
    if (character === '<') depth++
    else if (character === '>') {
      depth--
      if (depth === 0) return text.slice(openBracket + 1, i)
    }
  }
  return text.slice(openBracket + 1, openBracket + 200)
}

/**
 * Whether a type is talking about the catalogue.
 *
 * The catalogue's own names are `Provider`, `ProviderWithModels`,
 * `ProvidersResult` and `Model`; the property its providers carry is
 * `models`. The model state - the list of recently used and favourite models
 * the manager keeps - is a different thing, and its name does not match.
 */
function mentionsCatalogue(shape: string): boolean {
  return /(?<![A-Za-z0-9_])(Provider|ProviderWithModels|ProvidersResult|Model)(?![A-Za-z0-9_])/.test(shape)
    || /(?<![A-Za-z0-9_])models(?![A-Za-z0-9_])/.test(shape)
}

/**
 * Every file of the client, except this one.
 *
 * The gate writes down the very patterns it looks for, so it would find them
 * in its own source - and a rule that trips over the words that describe it
 * is a rule that stops being read.
 */
function sources(): { rel: string; text: string }[] {
  return graph.files
    .filter((file) => relativeTo(graph, file) !== SELF)
    .map((file) => ({
      rel: relativeTo(graph, file),
      text: stripComments(fs.readFileSync(file, 'utf8')),
    }))
}

/**
 * Every search for a model or a provider by name, in every file.
 *
 * The window after the call is read as well, because the name is often
 * compared on the next line - and because a name that only appears inside a
 * template string is not the element's own id.
 */
function lookups(): Offender[] {
  const found: Offender[] = []

  for (const { rel, text } of sources()) {
    const rules: { kind: string; pattern: RegExp; comparesId: boolean }[] = [
      { kind: '按 id 找 model', pattern: MODEL_SEARCH, comparesId: true },
      { kind: '按 id 找 provider', pattern: PROVIDER_SEARCH, comparesId: true },
      { kind: '按 id 找 provider', pattern: PARENTHESISED_PROVIDER_SEARCH, comparesId: true },
      { kind: '拿字典问 model', pattern: DICTIONARY_SEARCH, comparesId: false },
    ]

    for (const rule of rules) {
      for (const match of text.matchAll(rule.pattern)) {
        const window = text.slice(match.index, match.index + 200)
        if (rule.comparesId && !COMPARES_ID.test(window)) continue

        const line = text.slice(0, match.index).split('\n').length
        const snippet = window.split('\n')[0]?.trim() ?? ''
        found.push({
          rel,
          line,
          kind: rule.kind,
          snippet: snippet.length > 90 ? `${snippet.slice(0, 90)}...` : snippet,
        })
      }
    }
  }

  return found
}

describe('模型目录只有一份形状，只有两条路', () => {
  it('按 id 找 provider、找 model，只许在目录那一模块里', () => {
    const offenders = lookups().filter((entry) => entry.rel !== CATALOGUE)
    expect(
      offenders,
      [
        `目录只有 ${CATALOGUE} 一处知道它长什么样，别处自己找就是在用自己那份形状：`,
        ...offenders.map((entry) => `  ${entry.rel}:${entry.line}  ${entry.kind}  ${entry.snippet}`),
      ].join('\n'),
    ).toEqual([])
  })

  it('规则自己认得出要找的东西，不许空转', () => {
    // A rule over a set that is empty passes forever without protecting
    // anything, so the set itself has to be asserted: the catalogue has to
    // hold the very searches the rule is about.
    const inCatalogue = lookups().filter((entry) => entry.rel === CATALOGUE)
    expect(
      inCatalogue.map((entry) => entry.kind).sort(),
      '目录那一模块里没有它该有的那两处查找，规则已经认不出东西了',
    ).toEqual(['按 id 找 model', '按 id 找 provider'])

    // The same goes for the rule about a shape of one's own: the catalogue
    // reads the slot in the layer's shape, so the rule has to recognise that
    // read - otherwise it recognises nothing at all.
    const catalogueText = sources().find((source) => source.rel === CATALOGUE)?.text ?? ''
    const shapes = [...catalogueText.matchAll(/getQueryData</g)].map((match) =>
      typeArgumentOf(catalogueText, match.index + 'getQueryData'.length),
    )
    expect(
      shapes.filter((shape) => mentionsCatalogue(shape)).length,
      '规则认不出目录自己读槽位时写下的形状，这条规则就永远不会开口',
    ).toBeGreaterThan(0)
  })

  it('两个办法都真的有人在用', () => {
    const callers = (helper: string) =>
      sources()
        .filter((source) => source.rel !== CATALOGUE && source.text.includes(`${helper}(`))
        .map((source) => source.rel)
        .sort()

    expect(
      callers('findProvider'),
      'findProvider 没有别人用，说明有人在别处自己找 provider',
    ).not.toEqual([])
    expect(
      callers('findSelectedModel'),
      'findSelectedModel 没有别人用，说明有人在别处自己找 model',
    ).not.toEqual([])
  })

  it('客户端不许自己留一份目录的形状', () => {
    // The catalogue's models are a list. A client that keeps its own copy
    // writes down a dictionary - and then asks the dictionary questions of a
    // list, which is how every prompt sent with a model came to be refused.
    //
    // The shape is read here rather than written down: a client that reads the
    // slot with a type of its own may answer with one that has gone out of
    // date, and nothing in the compiler would notice.
    const offenders: Offender[] = []

    for (const { rel, text } of sources()) {
      if (rel === CATALOGUE) continue
      for (const match of text.matchAll(/getQueryData</g)) {
        const shape = typeArgumentOf(text, match.index + 'getQueryData'.length)
        if (!mentionsCatalogue(shape)) continue
        const line = text.slice(0, match.index).split('\n').length
        offenders.push({ rel, line, kind: '自己写了一份目录的形状', snippet: shape })
      }
    }

    expect(
      offenders,
      [
        '目录的形状由这一层说，客户端自己写一份就等于自己留一份真相：',
        ...offenders.map((entry) => `  ${entry.rel}:${entry.line}  ${entry.snippet}`),
      ].join('\n'),
    ).toEqual([])
  })
})
