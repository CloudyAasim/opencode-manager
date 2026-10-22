export const GIT_STATUS_COLORS = {
  modified: 'text-diff-modify',
  added: 'text-diff-add',
  deleted: 'text-diff-remove',
  renamed: 'text-diff-info',
  untracked: 'text-muted-foreground',
  copied: 'text-diff-add',
} as const

export const GIT_UI_COLORS = {
  ahead: 'text-diff-add',
  behind: 'text-diff-modify',
  current: 'text-primary',
  remote: 'text-diff-info',
  stage: 'text-diff-add',
  unstage: 'text-diff-remove',
  stagedBadge: 'bg-diff-add/10 text-diff-add dark:bg-diff-add/20',
  unpushed: 'bg-diff-info/10 text-diff-info dark:bg-diff-info/20',
  pushed: 'bg-diff-pushed/10 text-diff-pushed dark:bg-diff-pushed/20',
} as const

export const GIT_DIFF_BACKGROUNDS = {
  modified: 'bg-diff-modify/10',
  added: 'bg-diff-add/10',
  deleted: 'bg-diff-remove/10',
  renamed: 'bg-diff-info/10',
  copied: 'bg-diff-add/10',
} as const

export const GIT_STATUS_LABELS = {
  modified: 'Modified',
  added: 'Added',
  deleted: 'Deleted',
  renamed: 'Renamed',
  untracked: 'Untracked',
  copied: 'Copied',
} as const
