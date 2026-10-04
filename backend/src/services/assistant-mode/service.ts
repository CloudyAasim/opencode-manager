import path from 'path'
import { ValidationError } from '../../utils/errors'
import { type Repo } from '@opencode-manager/shared/types'
import { type AssistantModeStatus, type AssistantModeInitRequest, type OpenCodeConfigInput } from '@opencode-manager/shared/types'
import { readFileContent, writeFileContent, fileExists, ensureDirectoryExists } from '../file-operations'
import { OpenCodeConfigSchema } from '@opencode-manager/shared/schemas'
import { ASSISTANT_REPO_ID, ASSISTANT_OPENCODE_DIR_NAME } from '@opencode-manager/shared/utils'
import { getAssistantModePath, getReposPath, getUserReposPath, getUserSettingPath } from '@opencode-manager/shared/config/env'
import { type Database } from 'bun:sqlite'
import { ensureAssistantRepo } from '../../db/queries'
import { hasSameContentHash } from './content'
import { buildSchedulesSkill } from './skills'
import { buildNotificationsSkill } from './skills'
import { buildSettingsSkill } from './skills'
import { buildReposSkill } from './skills'
import { buildAssistantAgentsMd } from './agents-md'
import { buildAssistantAgentPermission } from './agents-md'
import { buildAssistantDefaultAgentMd } from './agents-md'
import { matchesGeneratedAssistantAgentsMd } from './legacy'
import { matchesGeneratedAssistantDefaultAgentMd } from './legacy'
import { matchesGeneratedAssistantAgentPrompt } from './legacy'
import { containsLegacyAssistantAgentsGuidance } from './legacy'

export const ASSISTANT_MODE_RELATIVE_PATH = 'repos/assistant'

export const ASSISTANT_AGENTS_MD_FILENAME = 'AGENTS.md'

export const ASSISTANT_OPENCODE_CONFIG_FILENAME = 'opencode.json'

export const ASSISTANT_OPENCODE_DIR = ASSISTANT_OPENCODE_DIR_NAME

export const ASSISTANT_SKILLS_DIR = 'skills'

export const ASSISTANT_SCHEDULES_SKILL_DIR = 'schedule-management'

export const ASSISTANT_NOTIFICATIONS_SKILL_DIR = 'notifications'

export const ASSISTANT_SETTINGS_SKILL_DIR = 'manager-settings'

export const ASSISTANT_REPOS_SKILL_DIR = 'repo-management'

export const ASSISTANT_SKILL_FILENAME = 'SKILL.md'

export const ASSISTANT_AGENTS_DIR = 'agents'

export const ASSISTANT_DEFAULT_AGENT_NAME = 'assistant'

export const ASSISTANT_DEFAULT_AGENT_FILENAME = `${ASSISTANT_DEFAULT_AGENT_NAME}.md`

export function getAssistantModeDirectory(username?: string | null): string {
  if (username) {
    return path.resolve(getUserSettingPath(username), 'assistant')
  }

  const assistantDir = getAssistantModePath()
  const resolvedReposRoot = path.resolve(getReposPath())
  const resolvedAssistantDir = path.resolve(assistantDir)

  if (!resolvedAssistantDir.startsWith(resolvedReposRoot)) {
    throw new ValidationError('Assistant mode directory must be within repos root')
  }

  return resolvedAssistantDir
}

export function assistantRelativePath(username?: string | null): string {
  return username ? `users/${username}/assistant` : ASSISTANT_MODE_RELATIVE_PATH
}

/**
 * Where this user's projects live, spelled out for the assistant.
 *
 * The repo-management skill used to describe the projects API as read-only, so
 * the assistant had no documented way to add a project and reached for
 * `git clone` - which it ran in its own configuration directory, where the
 * result is invisible in the app and cannot be deleted from it. Naming the
 * directory in the skill is what makes "add a project" an action with a place
 * to put the result.
 */
function projectsDirectoryFor(username?: string | null): string {
  return username ? getUserReposPath(username) : getReposPath()
}

export function buildAssistantRepo(username?: string | null): Repo {
  return {
    id: ASSISTANT_REPO_ID,
    localPath: 'assistant',
    fullPath: getAssistantModeDirectory(username),
    defaultBranch: 'main',
    cloneStatus: 'ready',
    clonedAt: Date.now(),
    isWorktree: false,
    isLocal: false,
  }
}

export function getSchedulesSkillPath(assistantDir: string): string {
  return path.join(assistantDir, ASSISTANT_OPENCODE_DIR, ASSISTANT_SKILLS_DIR, ASSISTANT_SCHEDULES_SKILL_DIR, ASSISTANT_SKILL_FILENAME)
}

export function getNotificationsSkillPath(assistantDir: string): string {
  return path.join(assistantDir, ASSISTANT_OPENCODE_DIR, ASSISTANT_SKILLS_DIR, ASSISTANT_NOTIFICATIONS_SKILL_DIR, ASSISTANT_SKILL_FILENAME)
}

export function getSettingsSkillPath(assistantDir: string): string {
  return path.join(assistantDir, ASSISTANT_OPENCODE_DIR, ASSISTANT_SKILLS_DIR, ASSISTANT_SETTINGS_SKILL_DIR, ASSISTANT_SKILL_FILENAME)
}

export function getReposSkillPath(assistantDir: string): string {
  return path.join(assistantDir, ASSISTANT_OPENCODE_DIR, ASSISTANT_SKILLS_DIR, ASSISTANT_REPOS_SKILL_DIR, ASSISTANT_SKILL_FILENAME)
}

export function getAssistantDefaultAgentPath(assistantDir: string): string {
  return path.join(
    assistantDir,
    ASSISTANT_OPENCODE_DIR,
    ASSISTANT_AGENTS_DIR,
    ASSISTANT_DEFAULT_AGENT_FILENAME,
  )
}

export function buildAssistantOpenCodeConfig(): OpenCodeConfigInput {
  const config: OpenCodeConfigInput = {
    default_agent: ASSISTANT_DEFAULT_AGENT_NAME,
    instructions: ['AGENTS.md'],
    permission: buildAssistantAgentPermission(),
    agent: {
      [ASSISTANT_DEFAULT_AGENT_NAME]: { mode: 'primary' },
    },
  }

  const result = OpenCodeConfigSchema.safeParse(config)
  if (!result.success) {
    throw new ValidationError(`Generated OpenCode config is invalid: ${result.error.message}`)
  }

  return config
}

export async function ensureAssistantMode(
  repo: Repo,
  options?: AssistantModeInitRequest,
  username?: string | null,
): Promise<AssistantModeStatus> {
  const assistantDir = getAssistantModeDirectory(username)

  await ensureDirectoryExists(assistantDir)

  const agentsMdPath = path.join(assistantDir, ASSISTANT_AGENTS_MD_FILENAME)
  const opencodeJsonPath = path.join(assistantDir, ASSISTANT_OPENCODE_CONFIG_FILENAME)
  const skillPath = getSchedulesSkillPath(assistantDir)
  const assistantAgentPath = getAssistantDefaultAgentPath(assistantDir)

  const agentsMdExists = await fileExists(agentsMdPath)
  const opencodeJsonExists = await fileExists(opencodeJsonPath)

  const overwriteOpenCodeConfig = options?.overwriteOpenCodeConfig ?? false

  const overwriteAgentsMd = options?.overwriteAgentsMd ?? false
  const agentsMdContent = buildAssistantAgentsMd()
  const existingAgentsMdContent = agentsMdExists ? await readFileContent(agentsMdPath) : undefined

  const agentsMdShouldMigrate =
    existingAgentsMdContent !== undefined &&
    matchesGeneratedAssistantAgentsMd(existingAgentsMdContent) &&
    !hasSameContentHash(existingAgentsMdContent, agentsMdContent)

  const agentsMdHasPreservedLegacyGuidance =
    existingAgentsMdContent !== undefined &&
    !overwriteAgentsMd &&
    !matchesGeneratedAssistantAgentsMd(existingAgentsMdContent) &&
    containsLegacyAssistantAgentsGuidance(existingAgentsMdContent)

  const agentsMdCreated =
    !agentsMdExists ||
    overwriteAgentsMd ||
    agentsMdShouldMigrate

  if (agentsMdCreated && !hasSameContentHash(existingAgentsMdContent, agentsMdContent)) {
    await writeFileContent(agentsMdPath, agentsMdContent)
  }

  const hasLegacyOpenCodeConfig = opencodeJsonExists && await isLegacyAssistantOpenCodeConfig(opencodeJsonPath)

  let opencodeJsonUpdated = false
  if (!opencodeJsonExists || overwriteOpenCodeConfig || hasLegacyOpenCodeConfig) {
    const config = hasLegacyOpenCodeConfig && opencodeJsonExists
      ? await (async () => {
          try {
            const existingContent = await readFileContent(opencodeJsonPath)
            const existingConfig = JSON.parse(existingContent) as OpenCodeConfigInput
            const mergedConfig = mergeAssistantOpenCodeConfig(existingConfig)
            return assistantOpenCodeConfigHasGeneratedAgentPersona(mergedConfig)
              ? stripGeneratedAssistantAgentPersona(mergedConfig)
              : mergedConfig
          } catch {
            return buildAssistantOpenCodeConfig()
          }
        })()
      : buildAssistantOpenCodeConfig()
    await writeFileContent(opencodeJsonPath, JSON.stringify(config, null, 2))
    opencodeJsonUpdated = true
  } else if (opencodeJsonExists) {
    try {
      const existingContent = await readFileContent(opencodeJsonPath)
      const existingConfig = JSON.parse(existingContent) as OpenCodeConfigInput
      const repairedConfig = assistantOpenCodeConfigNeedsRepair(existingConfig)
        ? mergeAssistantOpenCodeConfig(existingConfig)
        : existingConfig
      const updatedConfig = assistantOpenCodeConfigHasGeneratedAgentPersona(repairedConfig)
        ? stripGeneratedAssistantAgentPersona(repairedConfig)
        : repairedConfig

      if (updatedConfig !== existingConfig) {
        await writeFileContent(opencodeJsonPath, JSON.stringify(updatedConfig, null, 2))
        opencodeJsonUpdated = true
      }
    } catch {
      const config = buildAssistantOpenCodeConfig()
      await writeFileContent(opencodeJsonPath, JSON.stringify(config, null, 2))
      opencodeJsonUpdated = true
    }
  }

  await ensureDirectoryExists(path.join(assistantDir, ASSISTANT_OPENCODE_DIR))
  await ensureDirectoryExists(path.join(assistantDir, ASSISTANT_OPENCODE_DIR, ASSISTANT_AGENTS_DIR))
  await ensureDirectoryExists(path.join(assistantDir, ASSISTANT_OPENCODE_DIR, ASSISTANT_SKILLS_DIR, ASSISTANT_SCHEDULES_SKILL_DIR))
  await ensureDirectoryExists(path.join(assistantDir, ASSISTANT_OPENCODE_DIR, ASSISTANT_SKILLS_DIR, ASSISTANT_NOTIFICATIONS_SKILL_DIR))
  await ensureDirectoryExists(path.join(assistantDir, ASSISTANT_OPENCODE_DIR, ASSISTANT_SKILLS_DIR, ASSISTANT_SETTINGS_SKILL_DIR))
  await ensureDirectoryExists(path.join(assistantDir, ASSISTANT_OPENCODE_DIR, ASSISTANT_SKILLS_DIR, ASSISTANT_REPOS_SKILL_DIR))

  const schedulesSkillContent = buildSchedulesSkill()
  const existingSchedulesSkillContent = await fileExists(skillPath) ? await readFileContent(skillPath) : undefined
  const schedulesSkillCreated = !hasSameContentHash(existingSchedulesSkillContent, schedulesSkillContent)
  if (schedulesSkillCreated) {
    await writeFileContent(skillPath, schedulesSkillContent)
  }

  const notificationsSkillPath = getNotificationsSkillPath(assistantDir)
  const notificationsSkillContent = buildNotificationsSkill()
  const existingNotificationsSkillContent = await fileExists(notificationsSkillPath) ? await readFileContent(notificationsSkillPath) : undefined
  const notificationsSkillCreated = !hasSameContentHash(existingNotificationsSkillContent, notificationsSkillContent)
  if (notificationsSkillCreated) {
    await writeFileContent(notificationsSkillPath, notificationsSkillContent)
  }

  const settingsSkillPath = getSettingsSkillPath(assistantDir)
  const settingsSkillContent = buildSettingsSkill()
  const existingSettingsSkillContent = await fileExists(settingsSkillPath) ? await readFileContent(settingsSkillPath) : undefined
  const settingsSkillCreated = !hasSameContentHash(existingSettingsSkillContent, settingsSkillContent)
  if (settingsSkillCreated) {
    await writeFileContent(settingsSkillPath, settingsSkillContent)
  }

  const reposSkillPath = getReposSkillPath(assistantDir)
  const reposSkillContent = buildReposSkill(projectsDirectoryFor(username))
  const existingReposSkillContent = await fileExists(reposSkillPath) ? await readFileContent(reposSkillPath) : undefined
  const reposSkillCreated = !hasSameContentHash(existingReposSkillContent, reposSkillContent)
  if (reposSkillCreated) {
    await writeFileContent(reposSkillPath, reposSkillContent)
  }

  const assistantAgentExists = await fileExists(assistantAgentPath)
  const assistantAgentContent = buildAssistantDefaultAgentMd()
  const existingAssistantAgentContent = assistantAgentExists
    ? await readFileContent(assistantAgentPath)
    : undefined

  const assistantAgentShouldMigrate =
    existingAssistantAgentContent !== undefined &&
    matchesGeneratedAssistantDefaultAgentMd(existingAssistantAgentContent) &&
    !hasSameContentHash(existingAssistantAgentContent, assistantAgentContent)

  const assistantAgentCreated = !assistantAgentExists || assistantAgentShouldMigrate

  if (assistantAgentCreated) {
    await writeFileContent(assistantAgentPath, assistantAgentContent)
  }

  const managedUpdatesApplied = agentsMdCreated || opencodeJsonUpdated || assistantAgentCreated
  const warnings = managedUpdatesApplied && agentsMdHasPreservedLegacyGuidance
    ? [
        {
          code: 'assistant-agents-md-preserved',
          path: agentsMdPath,
          message: 'Some Assistant Mode instruction updates were not applied because AGENTS.md appears to contain customized legacy assistant instructions. To regenerate the default workspace explanation, manually delete AGENTS.md and initialize Assistant Mode again.',
        },
      ]
    : undefined

  return {
    repoId: repo.id,
    directory: assistantDir,
    relativePath: assistantRelativePath(username),
    warnings,
    files: {
      agentsMd: {
        path: agentsMdPath,
        exists: true,
        created: agentsMdCreated,
      },
      opencodeJson: {
        path: opencodeJsonPath,
        exists: true,
        created: opencodeJsonUpdated,
      },
    },

    schedulesSkill: {
      path: skillPath,
      created: schedulesSkillCreated,
    },
    notificationsSkill: {
      path: notificationsSkillPath,
      created: notificationsSkillCreated,
    },
    settingsSkill: {
      path: settingsSkillPath,
      created: settingsSkillCreated,
    },
    repoManagementSkill: {
      path: reposSkillPath,
      created: reposSkillCreated,
    },
    defaultAgent: {
      name: ASSISTANT_DEFAULT_AGENT_NAME,
      path: assistantAgentPath,
      exists: true,
      created: assistantAgentCreated,
    },
  }
}

export function assistantOpenCodeConfigNeedsRepair(config: OpenCodeConfigInput): boolean {
  if (config.default_agent !== ASSISTANT_DEFAULT_AGENT_NAME) return true
  if (!config.agent || typeof config.agent !== 'object') return true
  const assistantAgent = config.agent[ASSISTANT_DEFAULT_AGENT_NAME]
  if (!assistantAgent || typeof assistantAgent !== 'object') return true
  const mode = (assistantAgent as { mode?: unknown }).mode
  if (mode !== 'primary' && mode !== 'all') return true
  if ((assistantAgent as { disable?: unknown }).disable === true) return true
  if (assistantOpenCodeConfigHasGeneratedAgentPersona(config)) return true
  return false
}

export function assistantOpenCodeConfigHasGeneratedAgentPersona(config: OpenCodeConfigInput): boolean {
  const agent = config.agent?.[ASSISTANT_DEFAULT_AGENT_NAME]
  if (typeof agent !== 'object' || agent === null) return false
  const prompt = (agent as { prompt?: unknown }).prompt
  return matchesGeneratedAssistantAgentPrompt(prompt)
}

export function resolveValidAssistantMode(agent: unknown): 'primary' | 'all' {
  const mode = (agent as { mode?: unknown } | undefined)?.mode
  return mode === 'primary' || mode === 'all' ? mode : 'primary'
}

export function stripGeneratedAssistantAgentPersona(config: OpenCodeConfigInput): OpenCodeConfigInput {
  const existingAssistantAgent = config.agent?.[ASSISTANT_DEFAULT_AGENT_NAME]
  const validMode = resolveValidAssistantMode(existingAssistantAgent)

  return {
    ...config,
    agent: {
      ...(config.agent ?? {}),
      [ASSISTANT_DEFAULT_AGENT_NAME]: { mode: validMode },
    },
  }
}

export function mergeAssistantOpenCodeConfig(existing?: OpenCodeConfigInput): OpenCodeConfigInput {
  const generated = buildAssistantOpenCodeConfig()
  const existingAssistantAgent = existing?.agent?.[ASSISTANT_DEFAULT_AGENT_NAME]
  const validMode = resolveValidAssistantMode(existingAssistantAgent)

  const existingIsGenerated = existingAssistantAgent != null &&
    typeof existingAssistantAgent === 'object' &&
    matchesGeneratedAssistantAgentPrompt(
      (existingAssistantAgent as { prompt?: unknown }).prompt,
    )

  let mergedAssistantAgent: Record<string, unknown>
  if (existingIsGenerated) {
    mergedAssistantAgent = { mode: validMode }
  } else {
    mergedAssistantAgent = {
      ...(typeof existingAssistantAgent === 'object' && existingAssistantAgent !== null ? existingAssistantAgent : {}),
      mode: validMode,
      disable: false,
    }
  }

  return {
    ...generated,
    ...existing,
    default_agent: ASSISTANT_DEFAULT_AGENT_NAME,
    instructions: existing?.instructions ?? generated.instructions,
    permission: existing?.permission ?? generated.permission,
    agent: {
      ...(existing?.agent ?? {}),
      [ASSISTANT_DEFAULT_AGENT_NAME]: mergedAssistantAgent,
    },
  }
}

export async function isLegacyAssistantOpenCodeConfig(opencodeJsonPath: string): Promise<boolean> {
  try {
    const content = await readFileContent(opencodeJsonPath)
    const config = JSON.parse(content) as {
      permission?: { allow?: unknown; ask?: unknown }
    }
    if (Array.isArray(config.permission?.allow) || Array.isArray(config.permission?.ask)) return true
    return false
  } catch {
    return false
  }
}

export async function getAssistantModeStatus(repo: Repo, username?: string | null): Promise<AssistantModeStatus> {
  const assistantDir = getAssistantModeDirectory(username)

  const agentsMdPath = path.join(assistantDir, ASSISTANT_AGENTS_MD_FILENAME)
  const opencodeJsonPath = path.join(assistantDir, ASSISTANT_OPENCODE_CONFIG_FILENAME)
  const skillPath = getSchedulesSkillPath(assistantDir)
  const notificationsSkillPath = getNotificationsSkillPath(assistantDir)
  const settingsSkillPath = getSettingsSkillPath(assistantDir)
  const reposSkillPath = getReposSkillPath(assistantDir)
  const assistantAgentPath = getAssistantDefaultAgentPath(assistantDir)

  const agentsMdExists = await fileExists(agentsMdPath)
  const opencodeJsonExists = await fileExists(opencodeJsonPath)
  const assistantAgentExists = await fileExists(assistantAgentPath)

  return {
    repoId: repo.id,
    directory: assistantDir,
    relativePath: assistantRelativePath(username),
    files: {
      agentsMd: {
        path: agentsMdPath,
        exists: agentsMdExists,
        created: false,
      },
      opencodeJson: {
        path: opencodeJsonPath,
        exists: opencodeJsonExists,
        created: false,
      },
    },
    schedulesSkill: {
      path: skillPath,
      created: false,
    },
    notificationsSkill: {
      path: notificationsSkillPath,
      created: false,
    },
    settingsSkill: {
      path: settingsSkillPath,
      created: false,
    },
    repoManagementSkill: {
      path: reposSkillPath,
      created: false,
    },
    defaultAgent: {
      name: ASSISTANT_DEFAULT_AGENT_NAME,
      path: assistantAgentPath,
      exists: assistantAgentExists,
      created: false,
    },
  }
}

/**
 * Warm the assistant workspace at boot, for every account on the server.
 *
 * This ran before, but without a username, so it built the one directory that
 * nobody uses: getAssistantModeDirectory() is per-user, and the routes pass the
 * session's username while this did not. The result was a workspace that always
 * existed for the anonymous case and never for a real user, which is why the
 * conversation screen sat on its skeleton with the stream disconnected until
 * something asked again at runtime.
 *
 * Per user is the whole point of a per-user workspace, so warming it per user
 * is what makes the warm-up true.
 */
export async function installAssistantWorkspace(deps: {
  db: Database
}): Promise<AssistantModeStatus> {
  const assistantRepo = ensureAssistantRepo(deps.db)

  for (const username of listAssistantUsernames(deps.db)) {
    await ensureAssistantMode(assistantRepo, undefined, username)
  }

  // The anonymous workspace is the one the assistant repo itself points at, so
  // it is still created - it is just no longer the only one. This is what the
  // caller gets back, as before.
  return ensureAssistantMode(assistantRepo)
}

/**
 * Account names, in creation order. A user without a username (or with one that
 * is blank) has no separate workspace and is served by the anonymous one.
 */
function listAssistantUsernames(db: Database): string[] {
  const rows = db
    .prepare(`SELECT DISTINCT username FROM "user" WHERE username IS NOT NULL AND username != '' ORDER BY createdAt ASC`)
    .all() as Array<{ username: string }>
  return rows.map((row) => row.username)
}
