import { describe, it, expect, vi } from 'vitest'
import { QueryClient, CancelledError } from '@tanstack/react-query'
import { stopQueries } from './queryInvalidation'

// Found while measuring the 45s timeout, and reproduced against a real
// in-flight query first: `cancelQueries` rejects with CancelledError
// whenever it actually had a query running. Awaited bare inside a mutation,
// a background refetch that happens to be running at that instant takes the
// whole mutation down before it sends anything - the click looks like it did
// nothing at all. In a chat, message refetches run almost continuously, so
// this was reachable on every send and every delete.
//
// The rejection is stubbed here rather than provoked: cancelling a real query
// leaves react-query's own retryer promise unhandled, which the runner reports
// as an unrelated error. What matters is the contract - stopQueries must not
// let a cancellation through - and that is what these pin.
const cancelling = (client: QueryClient) =>
  vi.spyOn(client, 'cancelQueries').mockRejectedValue(new CancelledError('cancelled') as never)

describe('stopQueries', () => {
  it('resolves when the cancellation actually had something to stop', async () => {
    const client = new QueryClient()
    cancelling(client)
    await expect(stopQueries(client, { queryKey: ['in-flight'] })).resolves.toBeUndefined()
  })

  it('resolves when there was nothing to cancel', async () => {
    const client = new QueryClient()
    await expect(stopQueries(client, { queryKey: ['idle'] })).resolves.toBeUndefined()
  })

  it('is the difference between the work happening and the click doing nothing', async () => {
    const client = new QueryClient()
    cancelling(client)
    const mutationFn = vi.fn().mockResolvedValue('sent')

    const mutation = client.getMutationCache().build(client, {
      mutationFn,
      onMutate: async () => {
        await stopQueries(client, { queryKey: ['in-flight'] })
        return { snapshot: 'kept' }
      },
    })

    await mutation.execute(undefined)

    expect(mutationFn).toHaveBeenCalledTimes(1)
    expect(mutation.state.status).toBe('success')
    expect(mutation.state.context).toEqual({ snapshot: 'kept' })
  })
})
