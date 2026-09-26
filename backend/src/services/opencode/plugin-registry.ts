import { join } from 'path'
import { writeFileAtomic } from '../../utils/fs-safe'
import { buildGhEnvPluginSource } from '../opencode-gh-env-plugin'
import { buildManagerToolPluginSource } from '../opencode-manager-tool-plugin'

type ManagedOpenCodePlugin = {
  filename: string
  buildSource: () => string
}

const MANAGED_OPENCODE_PLUGINS: readonly ManagedOpenCodePlugin[] = [
  { filename: 'ocm-gh-env.js', buildSource: () => buildGhEnvPluginSource() },
  { filename: 'ocm-manager.js', buildSource: () => buildManagerToolPluginSource() },
]

export function getOpenCodePluginDir(configHome: string): string {
  return join(configHome, 'opencode', 'plugin')
}

export async function installManagedPlugins(configHome: string): Promise<void> {
  const dir = getOpenCodePluginDir(configHome)
  for (const plugin of MANAGED_OPENCODE_PLUGINS) {
    await writeFileAtomic(join(dir, plugin.filename), plugin.buildSource())
  }
}
