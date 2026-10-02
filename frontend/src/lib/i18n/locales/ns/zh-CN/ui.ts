export const ui = {
  backButton: {
    goBack: '返回',
  },
  combobox: {
    placeholder: '选择或输入…',
    clear: '清除',
    toggleOptions: '切换选项',
    pressEnterToUse: '按 Enter 使用“{{value}}”',
  },
  confirmDestructiveDialog: {
    cancel: '取消',
  },
  copyButton: {
    copy: '复制',
    copied: '已复制！',
  },
  deleteDialog: {
    warning: '这将永久删除“{{itemName}}”。此操作无法撤销。',
    delete: '删除',
    deleteConfiguration: '删除配置',
    deleting: '删除中…',
  },
  dialog: {
    close: '关闭',
  },
  discardDialog: {
    fileCount_one: '1 个文件',
    fileCount_other: '{{count}} 个文件',
    title: '放弃更改',
    description: '确定要放弃对 {{itemText}} 的更改吗？此操作无法撤销。',
    warning:
      '这将永久删除你对 {{itemText}} 未提交的更改。如果这些更改存在于暂存区，也会一并移除。',
    confirm: '放弃',
    pending: '放弃中…',
  },
  downloadDialog: {
    ignoredPathsLoadFailed: '加载忽略路径失败',
    downloadAll: '全部下载',
    processing: '处理中…',
    creatingArchive: '正在创建 ZIP 压缩包，请稍候…',
    downloadStarting: '下载即将开始…',
    downloadFailed: '下载失败',
    cancel: '取消',
    download: '下载',
  },
  editorFindBar: {
    placeholder: '在内容中查找…',
    findInContent: '在内容中查找',
    matchCounter: '第 {{current}} 项，共 {{total}} 项',
    noMatches: '0 个匹配项',
    previousMatch: '上一个匹配项',
    nextMatch: '下一个匹配项',
  },
  errorBoundary: {
    title: '出错了',
    tryAgain: '重试',
  },
  header: {
    settings: '设置',
  },
  multiSelect: {
    placeholder: '请选择…',
    searchPlaceholder: '搜索…',
    noOptionsFound: '未找到选项',
    removeOption: '移除 {{label}}',
  },
  panelLoading: {
    label: '加载中…',
  },
  pendingActionBadge: {
    title_one: '{{count}} 个待处理的{{label}}',
    title_other: '{{count}} 个待处理的{{label}}',
  },
  routeErrorBoundary: {
    authenticationRequiredTitle: '需要身份验证',
    authenticationRequiredMessage: '请登录后访问此页面。',
    pageNotFoundTitle: '页面未找到',
    pageNotFoundMessage: '你访问的页面不存在。',
    error: '错误',
    offlineTitle: '你处于离线状态',
    unexpectedTitle: '意外错误',
    unexpectedMessage: '发生了意外错误，请尝试刷新页面。',
    reload: '重新加载',
    login: '登录',
    tryAgain: '重试',
  },
  sessionStatusIndicator: {
    retry: '重试 #{{attempt}}',
    countdown: '({{seconds}} 秒)',
  },
  settingsList: {
    loading: '加载中…',
    failedToLoad: '加载失败',
  },
  sidebar: {
    ariaLabel: '侧边栏',
    expand: '展开侧边栏',
    collapse: '收起侧边栏',
  },
  sideDrawer: {
    close: '关闭',
  },
  unsavedChangesDialog: {
    title: '未保存的更改',
    description: '你有未保存的编辑。',
    descriptionWithItem: '你对 {{itemName}} 有未保存的编辑。',
    warning: '放弃后将永久丢失这些编辑。',
    discard: '放弃',
    keepEditing: '继续编辑',
  },
  virtualizedTextView: {
    errorLoadingFile: '加载文件出错：{{message}}',
    loading: '加载中…',
    noContent: '无内容',
    saving: '保存中…',
    saveChanges: '保存更改 (Ctrl+S)',
  },
}
