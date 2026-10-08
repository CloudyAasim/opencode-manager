/**
 * Whether this bundle is running inside a native shell, and what that shell
 * lets the page ask it to do.
 *
 * The Android app is a WebView pointed at a loopback proxy, so the page it
 * renders is this same bundle - which means anything added for Android's sake
 * shows up on the web and in the desktop client too unless it is conditional.
 * This is the condition.
 *
 * It is a bridge object rather than a DOM element injected from outside on
 * purpose: the page re-renders, and an element planted into it from the shell
 * gets wiped on the next render or ends up duplicated. A method on an object
 * the shell owns cannot go stale, and it needs no timing agreement about when
 * the page has finished mounting.
 *
 * The shell adds `changeServer` and nothing else. The server address lives in
 * the shell's own storage - the page cannot read or write it - so this is the
 * one thing the page genuinely cannot do for itself.
 */
export interface HostShell {
  /** Open the shell's own "which server?" dialog. */
  changeServer(): void
}

/**
 * The shell bridge, or `null` when there is none.
 *
 * Validated rather than merely presence-checked: a bridge from an older or
 * newer shell could be missing the method, and a button that renders and then
 * throws on click is worse than one that never renders.
 */
export function hostShell(): HostShell | null {
  if (typeof window === 'undefined') return null

  const candidate = (window as unknown as { OCMAndroidHost?: Partial<HostShell> }).OCMAndroidHost
  if (!candidate || typeof candidate.changeServer !== 'function') return null

  return { changeServer: () => candidate.changeServer?.() }
}
