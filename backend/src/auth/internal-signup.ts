import { AsyncLocalStorage } from 'node:async_hooks'

const internalSignupStorage = new AsyncLocalStorage<boolean>()

export function isInternalSignupAllowed(): boolean {
  return internalSignupStorage.getStore() === true
}

export function withInternalSignup<T>(operation: () => Promise<T>): Promise<T> {
  return internalSignupStorage.run(true, operation)
}
