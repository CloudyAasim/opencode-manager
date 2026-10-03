export const STORAGE_KEYS = {
  chatPanelTabs: 'ocm.chatPanelTabs',
  sessionRailWidth: 'ocm.sessionRailWidth',
  chatPanelWidth: 'ocm.chatPanelWidth',
  fileTreeWidth: 'ocm.fileTreeWidth',
  locale: 'ocm.locale',
  fileSplitPct: 'ocm.fileSplitPct',
  inspectorOpen: 'ocm.inspectorOpen',
  inspectorWidth: 'ocm.inspectorWidth',
  inspectorTab: 'ocm.inspectorTab',
  inspectorTabOrder: 'ocm.inspectorTabOrder',
  sessionOrder: 'ocm.sessionOrder',
} as const

export type StorageKey = (typeof STORAGE_KEYS)[keyof typeof STORAGE_KEYS]