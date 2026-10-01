import { RepoSwitcher } from './RepoSwitcher'

export function TopBar() {
  return (
    <header className="flex h-11 shrink-0 items-center gap-2 border-b border-border bg-card px-3">
      <span className="text-sm font-semibold tracking-tight">OpenCode Manager</span>
      <RepoSwitcher />
    </header>
  )
}
