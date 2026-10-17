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
