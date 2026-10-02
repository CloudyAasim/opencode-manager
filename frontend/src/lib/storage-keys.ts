export const STORAGE_KEYS = {
  chatPanelTabs: 'ocm.chatPanelTabs',
  sessionRailWidth: 'ocm.sessionRailWidth',
  chatPanelWidth: 'ocm.chatPanelWidth',
  fileTreeWidth: 'ocm.fileTreeWidth',
  sidebarCollapsed: 'oc:sidebar:collapsed',
  locale: 'ocm.locale',
  fileSplitPct: 'ocm.fileSplitPct',
  inspectorOpen: 'ocm.inspectorOpen',
  inspectorWidth: 'ocm.inspectorWidth',
  inspectorTab: 'ocm.inspectorTab',
} as const

export type StorageKey = (typeof STORAGE_KEYS)[keyof typeof STORAGE_KEYS]