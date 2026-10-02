// One vocabulary for rebindable keyboard actions.
//
// The action names used to live in three places: the shortcut hook's switch
// statement, the settings panel's two group lists, and a copy of the direct
// list in each. Because the hook dispatched through a fixed switch, the panel
// could advertise an action the runtime ignored - which is exactly what
// happened to variantCycle. The default chord for every action belongs to
// DEFAULT_KEYBOARD_SHORTCUTS; the direct/leader split belongs to
// DEFAULT_DIRECT_SHORTCUTS. Neither is duplicated here.

export const CONVERSATION_ACTIONS: readonly string[] = [
  'submit',
  'abort',
  'toggleMode',
  'undo',
  'redo',
  'compact',
  'fork',
  'selectModel',
  'variantCycle',
]

export const NAVIGATION_ACTIONS: readonly string[] = [
  'settings',
  'sessions',
  'newSession',
  'closeSession',
  'toggleFileBrowser',
]

export const ALL_KEYBOARD_ACTIONS: readonly string[] = [
  ...CONVERSATION_ACTIONS,
  ...NAVIGATION_ACTIONS,
]
