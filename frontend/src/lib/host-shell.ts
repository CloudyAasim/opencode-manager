/**
 * Whether this bundle is running inside a native shell, and what that shell
 * lets the page ask it to do.
 *
 * The Android app is a WebView pointed at a loopback proxy, and the Windows
 * client is an Electron window pointed at one too, so the page either of them
 * renders is this same bundle - which means anything added for a shell's sake
 * shows up on the web unless it is conditional. This is the condition.
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
 *
 * Two names are accepted. `ocmHost` is the neutral one, used by the Windows
 * client; `OCMAndroidHost` is the Android app's, which predates the idea of
 * more than one shell and is still what that app injects.
 */
export interface HostShell {
  /** Open the shell's own "which server?" dialog. */
  changeServer(): void
}

/**
 * A shell bridge, whatever it happens to be able to do.
 *
 * Separate from {@link hostShell} because the two answer different questions.
 * "Is there a shell?" decides whether this page talks to its own origin or
 * to a remote one; "can the shell change the server?" decides whether a
 * button is worth rendering.
 */
export interface HostBridge {
  changeServer?: () => void
}

const BRIDGE_NAMES = ['ocmHost', 'OCMAndroidHost'] as const

/** The shell bridge, or `null` when there is no shell around this page. */
export function hostBridge(): HostBridge | null {
  if (typeof window === 'undefined') return null

  const globals = window as unknown as Record<string, HostBridge | undefined>
  for (const name of BRIDGE_NAMES) {
    const candidate = globals[name]
    if (candidate) return candidate
  }
  return null
}

/**
 * The shell bridge, or `null` when there is none.
 *
 * Validated rather than merely presence-checked: a bridge from an older or
 * newer shell could be missing the method, and a button that renders and then
 * throws on click is worse than one that never renders.
 */
export function hostShell(): HostShell | null {
  const bridge = hostBridge()
  if (!bridge || typeof bridge.changeServer !== 'function') return null

  return { changeServer: () => bridge.changeServer?.() }
}
