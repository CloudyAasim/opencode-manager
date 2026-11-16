import { describe, it, expect, vi } from 'vitest'
import { runBootDuties } from './boot-duties'

describe('runBootDuties', () => {
  it('runs every duty in the order it was given', async () => {
    const order: string[] = []

    await runBootDuties([
      { name: 'first', run: () => { order.push('first') } },
      { name: 'second', run: async () => { order.push('second') } },
      { name: 'third', run: () => { order.push('third') } },
    ])

    expect(order).toEqual(['first', 'second', 'third'])
  })

  /**
   * The whole point of the thing: one duty that fails is a smaller loss than
   * a host that never came up.
   */
  it('runs the duties after a failure', async () => {
    const ran: string[] = []

    const outcomes = await runBootDuties([
      {
        name: 'the door that will not open',
        run: () => { throw new Error('ENOENT: no such file or directory') },
      },
      { name: 'the administrator', run: () => { ran.push('the administrator') } },
      { name: 'the agent', run: () => { ran.push('the agent') } },
    ])

    expect(ran).toEqual(['the administrator', 'the agent'])
    expect(outcomes.map(o => o.ok)).toEqual([false, true, true])
  })

  it('reports the failure instead of hiding it', async () => {
    const failure = new Error('the disk said no')

    const outcomes = await runBootDuties([
      { name: 'the door that will not open', run: () => { throw failure } },
    ])

    expect(outcomes[0]?.name).toBe('the door that will not open')
    expect(outcomes[0]?.ok).toBe(false)
    expect(outcomes[0]?.error).toBe(failure)
  })

  it('waits for a duty that is asynchronous', async () => {
    let finished = false

    const outcomes = await runBootDuties([
      {
        name: 'the slow one',
        run: async () => {
          await new Promise(resolve => setTimeout(resolve, 5))
          finished = true
        },
      },
    ])

    expect(finished).toBe(true)
    expect(outcomes[0]?.ok).toBe(true)
  })

  it('lets a duty that rejects be reported like one that throws', async () => {
    const outcomes = await runBootDuties([
      { name: 'the one that gave up', run: async () => Promise.reject(new Error('nope')) },
      { name: 'the one after it', run: vi.fn() },
    ])

    expect(outcomes[0]?.ok).toBe(false)
    expect(outcomes[1]?.ok).toBe(true)
  })
})
