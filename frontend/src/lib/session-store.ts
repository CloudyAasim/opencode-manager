import { getSession, type AuthUser } from './auth-client'

/**
 * The session, and the only place it is kept.
 *
 * Every route used to ask the server for the session on its own:
 * `protectedLoader` called `getSession()` before it would let a page
 * render, so switching pages waited for a round trip to the server before
 * the new page appeared. On a link with a second of latency that second
 * is spent staring at the page you just left - and it is spent on every
 * single navigation, because the answer was thrown away each time.
 *
 * The session does not change between two navigations a second apart.
 * So it is kept here instead: the first caller fetches it, everybody
 * else gets the answer that is already known, and the navigation is
 * instant.
 *
 * Freshness is not given up for it. The provider revalidates the session
 * in the background - when the tab is focused, and on a slow timer - and
 * writes the answer back here. A session that has gone away is noticed
 * there, not on the navigation that would have blocked.
 */

let known: boolean = false
let user: AuthUser | null = null
let inFlight: Promise<AuthUser | null> | null = null

/** The session, if it is already known. No request is made. */
export function knownUser(): AuthUser | null {
  return known ? user : null
}

/** Whether the session has been established at all. */
export function isSessionKnown(): boolean {
  return known
}

/**
 * Record what we now know about the session.
 *
 * `null` means "known, and there is no session" - which is different
 * from "not known yet", and the difference matters: the first one means
 * the page is not for you, the second means we have not asked yet.
 */
export function rememberUser(next: AuthUser | null): void {
  user = next
  known = true
}

/** Forget the session - after a sign-out, or when the server says it is gone. */
export function forgetUser(): void {
  user = null
  known = false
}

/**
 * The session, waiting for it if it is not known yet.
 *
 * Concurrent callers share one request. Two pages asking at once must not
 * turn into two round trips to the server, and the second one to arrive
 * must not be able to overwrite the first one's answer.
 */
export function sharedUser(): Promise<AuthUser | null> {
  if (known) return Promise.resolve(user)
  if (!inFlight) {
    inFlight = getSession()
      .then((result) => {
        const next = (result?.data?.user as AuthUser | undefined) ?? null
        rememberUser(next)
        return next
      })
      .finally(() => {
        inFlight = null
      })
  }
  return inFlight
}
