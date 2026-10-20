import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { repoRoot } from '../helpers/repo-root'

function scriptsOf(...segments: string[]): Record<string, string> {
  const file = path.join(repoRoot, ...segments, 'package.json')
  return JSON.parse(fs.readFileSync(file, 'utf8')).scripts as Record<string, string>
}

const SHUFFLE = '--sequence.shuffle=true'

/**
 * The suites run with `--sequence.shuffle=true`, and that flag is the only
 * thing that makes order-dependence visible.
 *
 * It was not optional. `vi.clearAllMocks()` forgets recorded calls but keeps
 * `mockReturnValue` and `mockImplementation`, so a stub installed for one test
 * survived into the next. The schedules file passed in declaration order and
 * failed under shuffling - each run landing on a different test - so local
 * runs and CI disagreed for reasons that had nothing to do with the change
 * under test. Three of my own verification passes in a row had been reported
 * against a plain `npx vitest run`, which is not this project's command and
 * shuffles nothing.
 *
 * An attempt to gate the *symptom* (flag files that install stubs in a test
 * body and call `clearAllMocks`) was written and dropped: it matched its own
 * sample, matched comments mentioning the call, and flagged files that are
 * correct. Keyed on the mechanism instead, which cannot false-positive -
 * the failure mode of a gate that matches too much is that everyone ignores it.
 *
 * Both legs are covered because both exist, and because reading one
 * `package.json` to answer a question about what CI runs is exactly how the
 * frontend leg got wrongly reported as unshuffled: the root script shuffles
 * it, the frontend's own script did not.
 */
describe('test commands shuffle the suite', () => {
  const root = scriptsOf()
  const backend = scriptsOf('backend')
  const frontend = scriptsOf('frontend')

  it('runs the backend suite with --sequence.shuffle', () => {
    expect(backend['test:vitest']).toContain(SHUFFLE)
    expect(backend['test']).toContain('test:vitest')
  })

  it('runs the frontend suite with --sequence.shuffle', () => {
    expect(root['test:frontend']).toContain(SHUFFLE)
    // And the frontend's own script, so that running it inside that package
    // shuffles too rather than being the one command that quietly does not.
    expect(frontend['test:run']).toContain(SHUFFLE)
  })

  it('routes the root test script through both shuffling legs', () => {
    // `pnpm test` is what CI runs and what AGENTS.md tells you to run, so it
    // has to carry the property rather than the package-local scripts alone.
    expect(root['test']).toContain('test:backend')
    expect(root['test']).toContain('test:frontend')
  })
})

/**
 * The gate above was written when the root script had two legs. It now has
 * four, and the two it did not mention were the two it could not see: the
 * desktop leg shuffles because the desktop package's own script says so, and
 * the CLI leg did not shuffle at all - `vitest run` with no flag - so 262
 * tests had never run in a different order than the one they were written in.
 *
 * That is the same failure the whole gate exists to prevent, one level up: a
 * leg nobody looks at is a leg whose order-dependence is invisible. Naming
 * the missing legs by hand would fix it until the next leg is added.
 *
 * So this walks the chain instead. `pnpm test` is a sequence of `pnpm run
 * <leg>`; each leg is a `pnpm --filter <package> [run] <script>`; the script
 * that finally runs the tests is the one that has to carry the flag. A new
 * leg joins the chain and is checked without anyone remembering to add it.
 *
 * The chain is followed rather than assumed, because the legs are spelled
 * three different ways - `pnpm --filter <pkg> <script>`, `pnpm --filter <pkg>
 * run <script>`, and `pnpm --filter <pkg> exec vitest run ...` - and a
 * resolver that only understood one of them would quietly skip the others.
 *
 * A leg counts as covered when *some* branch of it reaches a shuffling
 * invocation. The backend leg is the case that forces this: its `test` script
 * runs `test:bun` (Bun's own runner, which has no such flag) and then
 * `test:vitest` (which does). The flag has to be on the vitest one, and
 * demanding it on the bun one would be asking for a flag that does not exist.
 */
describe('every leg the root test script runs shuffles its suite', () => {
  const root = scriptsOf()

  // `noUncheckedIndexedAccess` is on, so every script lookup is possibly
  // undefined. The fallback is empty rather than asserted here: a root script
  // that went missing has to make the self-check below fail, not throw.
  const rootTest = root['test'] ?? ''

  /** The legs the root `test` script runs, in order. */
  const legs = [...rootTest.matchAll(/pnpm run ([\w:.-]+)/g)]
    .map((match) => match[1])
    .filter((name): name is string => name !== undefined)

  /**
   * Does this command reach a shuffling test invocation?
   *
   * `dir` is the package whose scripts a bare `pnpm run <name>` refers to:
   * null for the root, the package directory for a filtered one.
   */
  const reachesShuffle = (dir: string | null, command: string, seen: Set<string>): boolean => {
    if (command.includes(SHUFFLE)) return true

    const local = dir === null ? root : scriptsOf(dir)

    for (const match of command.matchAll(/pnpm run ([\w:.-]+)/g)) {
      const name = match[1]
      if (!name) continue
      const key = `${dir ?? '.'}:${name}`
      if (seen.has(key)) continue
      seen.add(key)
      const script = local[name]
      if (script && reachesShuffle(dir, script, seen)) return true
    }

    for (const match of command.matchAll(/pnpm --filter (\S+) (?:run )?([\w:.-]+)/g)) {
      const pkg = match[1]
      const name = match[2]
      if (!pkg || !name) continue
      // The filter is a workspace package name and the directory it lives in
      // is its last segment - the same convention the workspace file uses.
      const target = pkg.split('/').pop() as string
      const key = `${target}:${name}`
      if (seen.has(key)) continue
      seen.add(key)
      const script = scriptsOf(target)[name]
      if (script && reachesShuffle(target, script, seen)) return true
    }

    return false
  }

  it('finds the legs the root test script runs', () => {
    // A gate that scans nothing is worse than no gate: it would pass while
    // the chain it is meant to follow changed shape underneath it. The
    // comparison is against the segments of the script rather than a list of
    // names, so a new leg is not a failure - an emptied chain is.
    expect(legs.length).toBe(rootTest.split('&&').length)
    expect(legs.length).toBeGreaterThan(0)
    // And the chain still runs package suites at all: the root script names
    // its legs, and each leg is the one that names a package.
    expect(legs.some((leg) => (root[leg] ?? '').includes('pnpm --filter'))).toBe(true)
  })

  it('shuffles every one of them', () => {
    for (const leg of legs) {
      expect(reachesShuffle(null, root[leg] ?? '', new Set()), leg).toBe(true)
    }
  })
})
