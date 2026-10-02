/**
 * Every layer name the app can put in the URL.
 *
 * LayerProvider seeds its stack from `?dialog=<name>`, which means a URL
 * coming from anywhere - a shared link, a hand edit, a stale bookmark - can
 * name a layer that nothing renders. That used to be accepted: the provider
 * would believe it, keep it in the stack, and write it back to the URL, so
 * the address bar said a dialog was open while the page showed nothing, and
 * the phantom entry stayed underneath every dialog opened afterwards.
 *
 * This list is what turns that string into either a real layer or nothing.
 * The layer-openers gate checks it against the actual useLayer call sites,
 * so it cannot drift in either direction.
 */
export const KNOWN_LAYERS: ReadonlySet<string> = new Set([
  'addRepo',
  'commandPalette',
  'createWorkspace',
  'files',
  'mcp',
  'sessions',
  'skills',
  'sourceControl',
  'workspaceSelector',
])

export function isKnownLayer(name: string | null | undefined): name is string {
  return typeof name === 'string' && KNOWN_LAYERS.has(name)
}
