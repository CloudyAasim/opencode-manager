export { discoverLocalRepos, relinkReposFromSessionDirectories } from './discovery'
export { initLocalRepo, cloneRepo, type CloneRepoOptions } from './clone'
export {
  getCurrentBranch,
  switchBranch,
  createBranch,
  pullRepo,
  resolveDefaultBranch,
} from './branch'
export { createWorktreeSafely, removeWorktree } from './worktree'
export { deleteRepoFiles } from './delete'
export {
  ensureMirrorTarget,
  ensureMirrorTargetPath,
  planMirrorTarget,
  type MirrorTargetPlan,
} from './mirror'
export { createRepoRow, getSiblingRepos, isRepoInUse } from './records'
