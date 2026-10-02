export const ui = {
  backButton: {
    goBack: 'Go back',
  },
  combobox: {
    placeholder: 'Select or type...',
    clear: 'Clear',
    toggleOptions: 'Toggle options',
    pressEnterToUse: 'Press Enter to use "{{value}}"',
  },
  confirmDestructiveDialog: {
    cancel: 'Cancel',
  },
  copyButton: {
    copy: 'Copy',
    copied: 'Copied!',
  },
  deleteDialog: {
    warning: 'This will permanently delete "{{itemName}}". This action cannot be undone.',
    delete: 'Delete',
    deleteConfiguration: 'Delete Configuration',
    deleting: 'Deleting...',
  },
  dialog: {
    close: 'Close',
  },
  discardDialog: {
    fileCount_one: '1 file',
    fileCount_other: '{{count}} files',
    title: 'Discard Changes',
    description: 'Are you sure you want to discard changes to {{itemText}}? This action cannot be undone.',
    warning:
      'This will permanently delete your uncommitted changes to {{itemText}}. If these changes exist in the staging area, they will also be removed.',
    confirm: 'Discard',
    pending: 'Discarding...',
  },
  downloadDialog: {
    ignoredPathsLoadFailed: 'Failed to load ignored paths',
    downloadAll: 'Download All',
    processing: 'Processing...',
    creatingArchive: 'Creating ZIP archive, please wait...',
    downloadStarting: 'Download starting...',
    downloadFailed: 'Download failed',
    cancel: 'Cancel',
    download: 'Download',
  },
  editorFindBar: {
    placeholder: 'Find in content...',
    findInContent: 'Find in content',
    matchCounter: '{{current}} of {{total}}',
    noMatches: '0 matches',
    previousMatch: 'Previous match',
    nextMatch: 'Next match',
  },
  errorBoundary: {
    title: 'Something went wrong',
    tryAgain: 'Try again',
  },
  header: {
    settings: 'Settings',
  },
  multiSelect: {
    placeholder: 'Select...',
    searchPlaceholder: 'Search...',
    noOptionsFound: 'No options found',
    removeOption: 'Remove {{label}}',
  },
  panelLoading: {
    label: 'Loading…',
  },
  pendingActionBadge: {
    title_one: '{{count}} pending {{label}}',
    title_other: '{{count}} pending {{label}}s',
  },
  routeErrorBoundary: {
    authenticationRequiredTitle: 'Authentication Required',
    authenticationRequiredMessage: 'Please log in to access this page.',
    pageNotFoundTitle: 'Page Not Found',
    pageNotFoundMessage: 'The page you are looking for does not exist.',
    error: 'Error',
    offlineTitle: "You're offline",
    unexpectedTitle: 'Unexpected Error',
    unexpectedMessage: 'An unexpected error occurred. Please try refreshing the page.',
    reload: 'Reload',
    login: 'Log in',
    tryAgain: 'Try again',
  },
  sessionStatusIndicator: {
    retry: 'Retry #{{attempt}}',
    countdown: '({{seconds}}s)',
  },
  settingsList: {
    loading: 'Loading...',
    failedToLoad: 'Failed to load',
  },
  sidebar: {
    ariaLabel: 'Sidebar',
    expand: 'Expand sidebar',
    collapse: 'Collapse sidebar',
  },
  sideDrawer: {
    close: 'Close',
  },
  unsavedChangesDialog: {
    title: 'Unsaved Changes',
    description: 'You have unsaved edits.',
    descriptionWithItem: 'You have unsaved edits to {{itemName}}.',
    warning: 'Discarding will permanently lose these edits.',
    discard: 'Discard',
    keepEditing: 'Keep Editing',
  },
  virtualizedTextView: {
    errorLoadingFile: 'Error loading file: {{message}}',
    loading: 'Loading...',
    noContent: 'No content',
    saving: 'Saving...',
    saveChanges: 'Save Changes (Ctrl+S)',
  },
}
