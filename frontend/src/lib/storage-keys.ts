export const STORAGE_KEYS = {
  chatPanelTabs: 'ocm.chatPanelTabs',
  sessionRailWidth: 'ocm.sessionRailWidth',
  chatPanelWidth: 'ocm.chatPanelWidth',
  fileTreeWidth: 'ocm.fileTreeWidth',
  sidebarCollapsed: 'oc:sidebar:collapsed',
  locale: 'ocm.locale',
  fileSplitPct: 'ocm.fileSplitPct',
} as const

export type StorageKey = (typeof STORAGE_KEYS)[keyof typeof STORAGE_KEYS]