import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { repoRoot } from '../helpers/repo-root'

const DOCKERFILE = path.join(repoRoot, 'Dockerfile')
const NVMRC = path.join(repoRoot, '.nvmrc')
const ROOT_PACKAGE = path.join(repoRoot, 'package.json')

function dockerfileNodeMajor(): string {
  const from = fs.readFileSync(DOCKERFILE, 'utf8').match(/^FROM node:(\d+)/m)
  if (!from) throw new Error('Dockerfile has no `FROM node:<major>` line to read a version from')
  return from[1]!
}

/**
 * The build image, CI and a developer's machine each pick their own Node, and
 * the bundle does not come out the same either way.
 *
 * That matters because of how this repository tells you to verify a deploy:
 * build locally and compare the hashed chunk name against the one the live
 * `index.html` references. That comparison is only meaningful when both sides
 * ran on the same Node major. Observed here: the same commit built on Node 24
 * produced `main-Dcq0VsmY.js` at 862 kB, and on Node 26 produced
 * `main-DFeSPKkg.js` at 924 kB - so the prescribed check reports a mismatch
 * against a perfectly healthy deployment, and the reader is sent hunting a
 * deploy problem that does not exist.
 *
 * The obligation cannot be derived from syntax - nothing forces a developer's
 * Node to match the image - so it is declared here and enforced against the
 * Dockerfile, which is the one place the version is genuinely decided.
 */
describe('Node 主版本在各处必须一致', () => {
  const dockerMajor = dockerfileNodeMajor()

  it('门禁自己看得见东西', () => {
    expect(dockerMajor, 'Dockerfile 里读不出 Node 主版本，这条门禁正在空跑').toMatch(/^\d+$/)
    expect(fs.existsSync(NVMRC), '缺 .nvmrc：开发者无从知道该用哪个 Node').toBe(true)
  })

  it('.nvmrc 与 Dockerfile 的 Node 主版本一致', () => {
    const declared = fs.readFileSync(NVMRC, 'utf8').trim()
    expect(
      declared,
      `.nvmrc 写的是 "${declared}"，而镜像构建的是 ${dockerMajor}——本地构建出来的产物会与线上不同`,
    ).toBe(dockerMajor)
  })

  it('package.json 的 engines 接受镜像的那个主版本，且不更宽', () => {
    const engines = (JSON.parse(fs.readFileSync(ROOT_PACKAGE, 'utf8')) as { engines?: { node?: string } })
      .engines
    expect(engines?.node, 'package.json 没有声明 engines.node，装依赖时不会有任何提示').toBeTruthy()
    expect(
      engines!.node,
      `engines.node 是 "${engines!.node}"，应当只放行镜像的 ${dockerMajor}；放宽它等于把这个问题重新放回来`,
    ).toBe(`>=${dockerMajor} <${Number(dockerMajor) + 1}`)
  })

  it('CI 用的 Node 主版本与 Dockerfile 一致', () => {
    const ci = fs.readFileSync(path.join(repoRoot, '.github/workflows/ci.yml'), 'utf8')
    const declared = [...ci.matchAll(/node-version:\s*"?(\d+)/g)].map((match) => match[1]!)
    expect(declared.length, 'ci.yml 里没有读到任何 node-version，这条规则正在空跑').toBeGreaterThan(0)
    const wrong = declared.filter((major) => major !== dockerMajor)
    expect(
      wrong,
      `ci.yml 用 Node ${wrong.join(', ')}，而镜像构建的是 ${dockerMajor}：CI 通过不等于产物一致`,
    ).toEqual([])
  })
})
