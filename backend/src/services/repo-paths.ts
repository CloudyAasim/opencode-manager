import { getReposPath } from '@opencode-manager/shared/config/env'
import { getAccessScope } from '../auth/access-scope'

export function reposBase(): string {
  return getAccessScope()?.repoBase ?? getReposPath()
}
