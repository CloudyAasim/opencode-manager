import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { repoRoot } from '../helpers/repo-root'

const PACKAGE_JSON = path.join(repoRoot, 'backend', 'package.json')

function testScripts(): Record<string, string> {
  return JSON.parse(fs.readFileSync(PACKAGE_JSON, 'utf8')).scripts as Record<string, string>
}

/**
 * The suite runs with `--sequence.shuffle=true`, and that flag is the only
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
 */
describe('test command shuffles the suite', () => {
  const scripts = testScripts()

  it('finds the vitest script', () => {
    expect(scripts['test:vitest']).toBeTruthy()
  })

  it('runs vitest with --sequence.shuffle', () => {
    expect(scripts['test:vitest']).toContain('--sequence.shuffle=true')
  })

  it('routes the plain test script through the shuffling one', () => {
    // So that `pnpm test` - what CI and AGENTS.md both say to run - keeps the
    // property even if someone adds a second vitest invocation.
    expect(scripts['test']).toContain('test:vitest')
  })
})
