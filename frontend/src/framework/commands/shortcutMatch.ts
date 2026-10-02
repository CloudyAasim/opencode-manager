export const PALETTE_SHORTCUTS: readonly string[] = ['Cmd+K', 'Ctrl+K']

function isMac(): boolean {
  if (typeof navigator === 'undefined') return false
  return navigator.platform.toUpperCase().indexOf('MAC') >= 0
}

export function normalizeShortcut(shortcut: string): string {
  return shortcut.replace(/Cmd/g, isMac() ? 'Cmd' : 'Ctrl')
}

const KEY_ALIASES: Readonly<Record<string, string>> = {
  ' ': 'Space',
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  ArrowLeft: 'Left',
  ArrowRight: 'Right',
  Enter: 'Return',
  Escape: 'Esc',
}

const MODIFIER_KEYS: ReadonlySet<string> = new Set(['Control', 'Meta', 'Alt', 'Shift'])

export function parseModifierShortcut(event: KeyboardEvent): string {
  const keys: string[] = []
  if (event.ctrlKey) keys.push('Ctrl')
  if (event.metaKey) keys.push('Cmd')
  if (event.altKey) keys.push('Alt')
  if (event.shiftKey) keys.push('Shift')
  return keys.join('+')
}

export function parseEventShortcut(event: KeyboardEvent): string {
  const keys: string[] = []
  if (event.ctrlKey) keys.push('Ctrl')
  if (event.metaKey) keys.push('Cmd')
  if (event.altKey) keys.push('Alt')
  if (event.shiftKey) keys.push('Shift')

  const mainKey = event.key
  if (MODIFIER_KEYS.has(mainKey)) return ''
  const alias = KEY_ALIASES[mainKey]
  if (alias) keys.push(alias)
  else if (mainKey.length === 1) keys.push(mainKey.toUpperCase())
  else keys.push(mainKey)
  return keys.join('+')
}

export function matchesShortcut(event: KeyboardEvent, shortcut: string): boolean {
  return parseEventShortcut(event) === shortcut
}

export function matchesUserShortcut(event: KeyboardEvent, declared: string): boolean {
  return parseEventShortcut(event) === normalizeShortcut(declared)
}
