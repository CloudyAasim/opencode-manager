import { logger } from '../utils/logger'

/**
 * One thing a host has to do before it can be called a host.
 */
export interface BootDuty {
  readonly name: string
  run(): Promise<void> | void
}

export interface BootDutyOutcome {
  readonly name: string
  readonly ok: boolean
  readonly error?: unknown
}

/**
 * Runs every duty, in order, whatever the ones before it did.
 *
 * The duties used to sit in one try block, so the first one that failed took
 * the rest with it: a host that could not open one door came up answering
 * 503 to everything, with a single line in the log to explain it. A duty is
 * a thing the host needs, not a thing the duty before it needs.
 *
 * A duty that fails is reported and the next one still runs. The host comes
 * up with less than it wanted, and it says which part is missing.
 */
export async function runBootDuties(duties: readonly BootDuty[]): Promise<BootDutyOutcome[]> {
  const outcomes: BootDutyOutcome[] = []
  for (const duty of duties) {
    try {
      await duty.run()
      outcomes.push({ name: duty.name, ok: true })
    } catch (error) {
      logger.error(`Boot duty "${duty.name}" failed; the host comes up without it`, error)
      outcomes.push({ name: duty.name, ok: false, error })
    }
  }
  return outcomes
}
