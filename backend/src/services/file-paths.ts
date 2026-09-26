import { getReposPath } from '@opencode-manager/shared/config/env'
import { getAccessScope } from '../auth/access-scope'

export function fileBase(): string {
  return getAccessScope()?.browseRoot || getReposPath()
}
