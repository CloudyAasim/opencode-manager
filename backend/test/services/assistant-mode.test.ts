import { describe, expect, it, beforeEach, afterEach } from 'bun:test'
import path from 'path'
import { access, mkdir, readFile, writeFile } from 'fs/promises'
import { Hono } from 'hono'
import { ensureAssistantMode, getAssistantModeStatus, getAssistantModeDirectory, buildSchedulesSkill, buildReposSkill, buildSettingsSkill, buildAssistantDefaultAgentMd, buildAssistantOpenCodeConfig, buildAssistantRepo, installAssistantWorkspace, resetAssistantWorkspace } from '../../src/services/assistant-mode'
import { createTempAssistantWorkspace, createTestDb, mockRepo } from '../helpers/assistant-workspace'
import { buildAssistantAgentPermission, buildAssistantDefaultAgentMdFromPrompt, PRIOR_ASSISTANT_AGENT_PERMISSION, buildAssistantAgentPrompt } from '../../src/services/assistant-mode/agents-md'
import { buildLegacyAssistantDefaultAgentMd, buildPreviousAssistantDefaultAgentMd, buildPriorAssistantDefaultAgentMd, buildPriorAssistantAgentPrompt, buildLegacyAssistantAgentPrompt, buildPreviousAssistantAgentPrompt, matchesGeneratedAssistantAgentPrompt } from '../../src/services/assistant-mode/legacy'
import { DEFAULT_AGENTS_MD } from '../../src/constants'
import { createInternalRoutes } from '../../src/routes/internal'
import { ScheduleService } from '../../src/services/schedules'
import { NotificationService } from '../../src/services/notification'
import { SettingsService } from '../../src/services/settings'
import { getOrCreateInternalToken } from '../../src/services/internal-token'
import { createOpenCodeClient } from '../../src/services/opencode/client'
import { getRepoById } from '../../src/db/queries'
import type { ScheduleWorktreeManager } from '../../src/services/schedule-worktree'

describe('buildSchedulesSkill', () => {
  it('instructs the agent to use the ocm tool request action', () => {
    const skill = buildSchedulesSkill()
    expect(skill).toContain('"action": "request"')
    expect(skill).toContain('"method": "GET"')
    expect(skill).toContain('"path": "/schedules/all"')
    expect(skill).not.toContain('curl')
  })

  it('documents repoId 0 for Assistant schedules', () => {
    const skill = buildSchedulesSkill()
    expect(skill).toContain('Use repo ID `0` for the built-in Assistant')
    expect(skill).toContain('/repos/0/schedules')
  })
})

describe('historical assistant agent reconstruction', () => {
  it('reproduces every past generation under the permission block it shipped with', () => {
    // These builders exist to reconstruct a file that is already on disk so
    // the app recognises its own output and updates it. If one rebuilds with
    // today's permission block the hash matches nothing, the app concludes
    // the user hand-wrote the file, and the old permissions survive - the
    // tightening silently misses every account that already existed.
    //
    // Asserted on literals, not on one builder's output compared to
    // another's, so a mutation that changes what they all emit cannot hide.
    for (const [name, built] of [
      ['legacy', buildLegacyAssistantDefaultAgentMd()],
      ['previous', buildPreviousAssistantDefaultAgentMd()],
      ['prior', buildPriorAssistantDefaultAgentMd()],
    ] as const) {
      expect(built, name).toContain('bash: allow')
      expect(built, name).toContain('external_directory: ask')
    }
  })

  it('pins the prior permission to the block that actually shipped', () => {
    // The reverse assertion: without it, the test above would also pass if
    // every builder drifted to the old block - which is the same failure in
    // the other direction, reaching no one either.
    expect(PRIOR_ASSISTANT_AGENT_PERMISSION).toEqual({
      read: 'allow',
      edit: 'allow',
      glob: 'allow',
      grep: 'allow',
      list: 'allow',
      bash: 'allow',
      external_directory: 'ask',
    })
  })

  it('gives the current agent no shell and no reach outside its own directory', () => {
    const permission = buildAssistantAgentPermission()
    // Not "ask". Every user's workspace is owned by the single OS account the
    // container runs as, so a shell in one assistant's directory is a shell
    // over every other user's projects.
    expect(permission.bash).toBe('deny')
    expect(permission.external_directory).toBe('deny')
    // The tools that do the assistant's actual job stay open.
    expect(permission).toMatchObject({
      read: 'allow',
      edit: 'allow',
      glob: 'allow',
      grep: 'allow',
      list: 'allow',
    })
  })

  it('defaults to the current permission and honours an override', () => {
    expect(buildAssistantDefaultAgentMdFromPrompt('body')).toContain('bash: deny')
    expect(buildAssistantDefaultAgentMdFromPrompt('body', PRIOR_ASSISTANT_AGENT_PERMISSION)).toContain('bash: allow')
  })
})

describe('assistant prompt generations', () => {
  // Every generation the prompt has ever shipped, oldest first. The list is
  // the contract: a generation that is missing from it is a generation whose
  // accounts silently stop being recognised, and nothing else in the suite
  // would notice.
  const generations = [
    buildLegacyAssistantAgentPrompt(),
    buildPreviousAssistantAgentPrompt(),
    buildPriorAssistantAgentPrompt(),
    buildAssistantAgentPrompt(),
  ]

  it('recognises every generation, so every account still gets managed updates', () => {
    for (const [index, generation] of generations.entries()) {
      expect(matchesGeneratedAssistantAgentPrompt(generation), `第 ${index} 代认不出来了`).toBe(true)
    }
  })

  it('keeps each generation distinct', () => {
    // If two of these are the same string, a generation was added without a
    // variant recording the one it replaced - the hash of the old file then
    // matches nothing and it is preserved as if the user had written it.
    for (let i = 0; i < generations.length; i++) {
      for (let j = i + 1; j < generations.length; j++) {
        expect(generations[i], `第 ${i} 代与第 ${j} 代相同，中间漏了一代`).not.toBe(generations[j])
      }
    }
  })

  it('keeps the prior generation frozen as it actually shipped', () => {
    // The load-bearing one. `buildPriorAssistantAgentPrompt` reproduces a file
    // that is already on disk; editing it to keep up with the current prompt
    // destroys the only copy of what that file used to be, and the failure is
    // silent - every account that ran that generation keeps the old prompt
    // forever and is reported as customised.
    const prior = buildPriorAssistantAgentPrompt()
    expect(prior).toContain('## This Directory Is Not Where Projects Go')
    expect(prior).not.toContain('The Two Names You Will See in the File Manager')
  })

  it('tells the assistant the file manager names are display names only', () => {
    // The other half: shortening the paths is a UI change, and the assistant is
    // the one thing that might act on a path the user reads off the screen.
    const current = buildAssistantAgentPrompt()
    expect(current).toContain('The Two Names You Will See in the File Manager')
    expect(current).toContain('display names')
    expect(current).toContain('Never pass `/workspace` or `/assistant` to a request')
  })

  it('says the same thing in the skill, next to the real path it gives', () => {
    const skill = buildReposSkill('/workspace/users/aasim/workspace/repos')
    expect(skill).toContain('Projects live in `/workspace/users/aasim/workspace/repos`')
    expect(skill).toContain('display names, not real paths')
  })
})

describe('buildReposSkill', () => {
  const reposPath = '/workspace/users/aasim/workspace/repos'

  it('instructs the agent to use the ocm tool request action', () => {
    const skill = buildReposSkill(reposPath)
    expect(skill).toContain('"action": "request"')
    expect(skill).toContain('"method": "GET"')
    expect(skill).toContain('"path": "/repos"')
  })

  it('contains GET /repos endpoint documentation', () => {
    const skill = buildReposSkill(reposPath)
    expect(skill).toContain('GET /repos')
  })

  it('does not instruct reading the internal token or sending a bearer header', () => {
    const skill = buildReposSkill(reposPath)
    expect(skill).not.toContain('Authorization: Bearer')
    expect(skill).not.toContain('.opencode/internal-token')
    expect(skill).not.toContain('curl')
  })

  it('does not contain a localhost base URL', () => {
    const skill = buildReposSkill(reposPath)
    expect(skill).not.toContain('localhost')
  })

  it('does not document the removed openCodeConfigName field', () => {
    const skill = buildReposSkill(reposPath)
    expect(skill).not.toContain('openCodeConfigName')
  })

  it('does not document a route the internal API does not have', () => {
    // Two rounds ago the skill said the repos API was read-only, and the
    // assistant reached for `git clone` instead. The fix was to document
    // `POST /repos` - which the internal API the assistant can actually reach
    // does not expose, so the agent spent a turn discovering that and then
    // fell back to the shell again. A route that is not in the allowlist is
    // worse than a missing route: it reads as an invitation.
    const skill = buildReposSkill(reposPath)
    expect(skill).not.toContain('### POST /repos')
    expect(skill).not.toContain('"repoUrl": "https://github.com/owner/name.git"')
    expect(skill).toContain('**You cannot add one.**')
    expect(skill).toContain('Projects screen')
  })

  it('names the projects directory, and forbids cloning into the assistant workspace', () => {
    const skill = buildReposSkill(reposPath)
    // The whole line, not just the path somewhere in the file: it also appears
    // in "Adding a project", so asserting `toContain(reposPath)` would pass
    // even when the line that ties the path to "projects live here" is gone -
    // and that line is the part that reaches the agent.
    expect(skill).toContain(`- Projects live in \`${reposPath}\` and nowhere else.`)
    expect(skill).toContain('becomes a project by itself')
    expect(skill).not.toContain('`git clone` in a shell')
  })
})

describe('the assistant is told where projects do not belong, and that it has no shell', () => {
  it('the agent prompt refuses to improvise a way to add a project', () => {
    const prompt = buildAssistantDefaultAgentMd()
    expect(prompt).toContain('You cannot add one yourself')
    expect(prompt).toContain('Projects screen')
    // A prompt that still advertised POST /repos would send the agent looking
    // for a route that does not exist, and it would improvise from there.
    expect(prompt).not.toContain('POST /repos')
  })

  it('the agent prompt says why there is no shell', () => {
    // Without the reason, "denied" reads as an obstacle to route around rather
    // than as the boundary it is.
    const prompt = buildAssistantDefaultAgentMd()
    expect(prompt).toContain('You Have No Shell')
    expect(prompt).toContain('one shared account')
    expect(prompt).toContain('ocm')
  })

  it('the shell is denied, not merely set to ask', () => {
    // `ask` is answered by whoever is at the keyboard; an unattended session
    // has nobody, and it does nothing about an assistant reading another
    // user's files.
    expect(buildAssistantAgentPermission().bash).toBe('deny')
    expect(buildAssistantAgentPermission().external_directory).toBe('deny')
  })

  it('the global agent instructions carry the same rule', () => {
    // The per-assistant prompt only reaches the Assistant. AGENTS.md is merged
    // into ordinary repo sessions too, where the same mistake is just as easy
    // to make.
    expect(DEFAULT_AGENTS_MD).toContain('git clone')
    expect(DEFAULT_AGENTS_MD).toContain('projects directory')
  })
})

describe('buildSettingsSkill', () => {
  it('instructs the agent to use the ocm tool request action', () => {
    const skill = buildSettingsSkill()
    expect(skill).toContain('"action": "request"')
    expect(skill).toContain('"path": "/settings?userId=default"')
    expect(skill).not.toContain('curl')
  })

  it('includes tts and stt in allowed non-secret preferences', () => {
    const skill = buildSettingsSkill()
    expect(skill).toContain('tts')
    expect(skill).toContain('stt')
    expect(skill).toContain('enabled')
    expect(skill).toContain('provider')
    expect(skill).toContain('autoPlay')
    expect(skill).toContain('voice')
    expect(skill).toContain('model')
    expect(skill).toContain('speed')
    expect(skill).toContain('language')
  })

  it('documents the POST /assistant/reload endpoint', () => {
    const skill = buildSettingsSkill()
    expect(skill).toContain('/assistant/reload')
    expect(skill).toContain('Always confirm with the user before reloading')
    expect(skill).toContain('5 requests per minute')
  })

  it('documents the OpenCode configuration endpoints', () => {
    const skill = buildSettingsSkill()
    expect(skill).toContain('## OpenCode Configuration')
    expect(skill).toContain('GET /opencode-config')
    expect(skill).toContain('PUT /opencode-config')
    expect(skill).toContain('restartRequired')
    expect(skill).toContain('Never attempt the restart yourself')
  })

  it('still lists apiKey and endpoint as forbidden', () => {
    const skill = buildSettingsSkill()
    expect(skill).toContain('tts.apiKey')
    expect(skill).toContain('tts.endpoint')
    expect(skill).toContain('stt.apiKey')
    expect(skill).toContain('stt.endpoint')
    expect(skill).toContain('DO NOT attempt to set')
  })
})

describe('buildAssistantDefaultAgentMd', () => {
  it('contains description and mode in frontmatter', () => {
    const content = buildAssistantDefaultAgentMd()
    expect(content).toContain('description: Default OpenCode Manager assistant workspace agent')
    expect(content).toContain('mode: primary')
  })

  it('references workspace skills', () => {
    const content = buildAssistantDefaultAgentMd()
    expect(content).toContain('repo-management')
    expect(content).toContain('schedule-management')
    expect(content).toContain('notifications')
    expect(content).toContain('manager-settings')
  })

  it('contains reload guidance in the agent prompt', () => {
    const content = buildAssistantDefaultAgentMd()
    expect(content).toContain('/assistant/reload')
    expect(content).toContain('Always ask the user before reloading')
  })

  it('does not contain v file', () => {
    const content = buildAssistantDefaultAgentMd()
    expect(content).not.toContain('v file')
  })
})

describe('buildAssistantOpenCodeConfig', () => {
  it('includes default_agent and agent.assistant with primary mode and no embedded persona', () => {
    const config = buildAssistantOpenCodeConfig()
    expect(config.default_agent).toBe('assistant')
    expect(config.agent?.assistant).toEqual({ mode: 'primary' })
    expect(config.agent?.assistant?.prompt).toBeUndefined()
    expect(config.agent?.assistant?.description).toBeUndefined()
    expect(config.agent?.assistant?.permission).toBeUndefined()
  })
})

describe('ensureAssistantMode', () => {
  let ws: Awaited<ReturnType<typeof createTempAssistantWorkspace>>

  beforeEach(async () => {
    ws = await createTempAssistantWorkspace()
  })
  afterEach(async () => { await ws.cleanup() })

  it('creates AGENTS.md, opencode.json, and SKILL.md on first run', async () => {
    await ensureAssistantMode(mockRepo)
    const agentsMd = await readFile(path.join(ws.assistantDir, 'AGENTS.md'), 'utf8')
    const opencodeJson = await readFile(path.join(ws.assistantDir, 'opencode.json'), 'utf8')
    const skill = await readFile(path.join(ws.assistantDir, '.opencode/skills/schedule-management/SKILL.md'), 'utf8')
    const repoSkill = await readFile(path.join(ws.assistantDir, '.opencode/skills/repo-management/SKILL.md'), 'utf8')
    const assistantAgent = await readFile(path.join(ws.assistantDir, '.opencode/agents/assistant.md'), 'utf8')

    expect(agentsMd).toContain('.opencode/agents/assistant.md')
    expect(agentsMd).not.toContain('Self-Editing Rules')
    const parsedConfig = JSON.parse(opencodeJson)
    expect(parsedConfig.default_agent).toBe('assistant')
    expect(parsedConfig).not.toHaveProperty('mcp')
    expect(parsedConfig.agent?.assistant).toEqual({ mode: 'primary' })
    expect(parsedConfig.agent?.assistant?.prompt).toBeUndefined()
    expect(parsedConfig.agent?.assistant?.description).toBeUndefined()
    expect(parsedConfig.agent?.assistant?.permission).toBeUndefined()
    expect(skill).toContain('"action": "request"')
    expect(skill).not.toContain('curl')
    expect(skill).not.toContain('Authorization: Bearer')
    expect(repoSkill).toContain('GET /repos')
    expect(repoSkill).not.toContain('Authorization: Bearer')
    expect(repoSkill).not.toContain('.opencode/internal-token')
    expect(assistantAgent).toContain('mode: primary')
    expect(assistantAgent).toContain('Default OpenCode Manager assistant workspace agent')
    expect(assistantAgent).not.toContain('v file')
    await expect(access(path.join(ws.assistantDir, '.opencode/internal-token'))).rejects.toThrow()
  })

  it('does not create a .opencode/internal-token file', async () => {
    await ensureAssistantMode(mockRepo)
    await expect(access(path.join(ws.assistantDir, '.opencode/internal-token'))).rejects.toThrow()
  })

  it('writes all files needed before OpenCode assistant session launch', async () => {
    const result = await ensureAssistantMode(mockRepo)

    const opencodeJsonPath = path.join(ws.assistantDir, 'opencode.json')
    const agentsMdPath = path.join(ws.assistantDir, 'AGENTS.md')
    const schedulesSkillPath = path.join(ws.assistantDir, '.opencode/skills/schedule-management/SKILL.md')
    const notificationsSkillPath = path.join(ws.assistantDir, '.opencode/skills/notifications/SKILL.md')
    const settingsSkillPath = path.join(ws.assistantDir, '.opencode/skills/manager-settings/SKILL.md')
    const reposSkillPath = path.join(ws.assistantDir, '.opencode/skills/repo-management/SKILL.md')
    const assistantAgentPath = path.join(ws.assistantDir, '.opencode/agents/assistant.md')

    const opencodeJsonContent = await readFile(opencodeJsonPath, 'utf8')
    const opencodeJson = JSON.parse(opencodeJsonContent)

    expect(opencodeJson.default_agent).toBe('assistant')
    expect(opencodeJson.instructions).toEqual(['AGENTS.md'])
    expect(opencodeJson.permission).toEqual({
      read: 'allow',
      edit: 'allow',
      glob: 'allow',
      grep: 'allow',
      list: 'allow',
      // Denied, not "ask". Every user's workspace is owned by the one OS
      // account the container runs as, so a shell in the assistant's directory
      // is a shell over every other user's projects too.
      bash: 'deny',
      external_directory: 'deny',
    })
    expect(opencodeJson.agent?.assistant).toEqual({ mode: 'primary' })
    expect(opencodeJson.agent?.assistant?.prompt).toBeUndefined()
    expect(opencodeJson.agent?.assistant?.description).toBeUndefined()
    expect(opencodeJson.agent?.assistant?.permission).toBeUndefined()

    const agentsMdContent = await readFile(agentsMdPath, 'utf8')
    expect(agentsMdContent).toContain('Assistant Mode Workspace')
    expect(agentsMdContent).toContain('.opencode/agents/assistant.md')
    expect(agentsMdContent).not.toContain('Self-Editing Rules')
    expect(agentsMdContent).not.toContain('Schedule Management')
    expect(agentsMdContent).not.toContain('Notifications')
    expect(agentsMdContent).not.toContain('Settings Management')
    expect(agentsMdContent).not.toContain('Repo Management')

    const schedulesSkillContent = await readFile(schedulesSkillPath, 'utf8')
    expect(schedulesSkillContent).toContain('name: schedule-management')
    expect(schedulesSkillContent).toContain('Manage schedule jobs')
    expect(schedulesSkillContent).toContain('Use repo ID `0` for the built-in Assistant')
    expect(schedulesSkillContent).toContain('/repos/0/schedules')

    const notificationsSkillContent = await readFile(notificationsSkillPath, 'utf8')
    expect(notificationsSkillContent).toContain('name: notifications')
    expect(notificationsSkillContent).toContain('Send push notifications')

    const settingsSkillContent = await readFile(settingsSkillPath, 'utf8')
    expect(settingsSkillContent).toContain('name: manager-settings')
    expect(settingsSkillContent).toContain('Read and modify')
    expect(settingsSkillContent).toContain('/opencode-config')
    expect(settingsSkillContent).toContain('restartRequired')

    const reposSkillContent = await readFile(reposSkillPath, 'utf8')
    expect(reposSkillContent).toContain('name: repo-management')
    // The description is what the agent matches on when deciding whether to
    // load the skill. It must not promise anything the agent cannot do: the
    // skill now says out loud that the assistant cannot add a project, so a
    // description offering to "add" would contradict the body of the very file
    // it introduces.
    expect(reposSkillContent).toContain('description: Inspect the projects available to OpenCode Manager')
    // And the file that lands on disk has to carry the concrete directory, not
    // just the rule - the agent has no way to derive the projects path itself.
    expect(reposSkillContent).toContain('Projects live in')
    expect(reposSkillContent).not.toContain('### POST /repos')

    const assistantAgentContent = await readFile(assistantAgentPath, 'utf8')
    expect(assistantAgentContent).toContain('mode: primary')
    expect(assistantAgentContent).toContain('Self-Editing')
    expect(assistantAgentContent).toContain('repo-management')
    expect(assistantAgentContent).toContain('schedule-management')
    expect(assistantAgentContent).toContain('notifications')
    expect(assistantAgentContent).toContain('manager-settings')

    expect(result.files.opencodeJson?.exists).toBe(true)
    expect(result.files.agentsMd?.exists).toBe(true)
    expect(result.repoManagementSkill?.path).toBe(reposSkillPath)
    expect(result.repoManagementSkill?.created).toBe(true)
    expect(result.defaultAgent?.name).toBe('assistant')
    expect(result.defaultAgent?.path).toBe(assistantAgentPath)
    expect(result.defaultAgent?.exists).toBe(true)
    expect(result.defaultAgent?.created).toBe(true)
  })

  it('reports repo management skill status from getAssistantModeStatus', async () => {
    await ensureAssistantMode(mockRepo)

    const status = await getAssistantModeStatus(mockRepo)

    expect(status.repoManagementSkill?.path).toBe(path.join(ws.assistantDir, '.opencode/skills/repo-management/SKILL.md'))
    expect(status.repoManagementSkill?.created).toBe(false)
  })

  it('preserves custom assistant agent content on subsequent ensureAssistantMode calls', async () => {
    await ensureAssistantMode(mockRepo)
    const assistantAgentPath = path.join(ws.assistantDir, '.opencode/agents/assistant.md')

    const customContent = '---\ndescription: Custom assistant\nmode: primary\n---\n\nCustom assistant instructions.'
    await writeFile(assistantAgentPath, customContent)

    const result2 = await ensureAssistantMode(mockRepo)

    const preservedContent = await readFile(assistantAgentPath, 'utf8')
    expect(preservedContent).toBe(customContent)
    expect(result2.defaultAgent?.created).toBe(false)
  })

  it('repairs existing assistant opencode config missing configured assistant agent', async () => {
    await ensureAssistantMode(mockRepo)
    const opencodeJsonPath = path.join(ws.assistantDir, 'opencode.json')
    await writeFile(opencodeJsonPath, JSON.stringify({
      model: 'provider/model',
      instructions: ['AGENTS.md'],
      default_agent: 'build',
      agent: {
        custom: { mode: 'primary', prompt: 'Custom agent' },
      },
      skills: { paths: ['.opencode/skills'] },
    }, null, 2))

    const result = await ensureAssistantMode(mockRepo)
    const repaired = JSON.parse(await readFile(opencodeJsonPath, 'utf8'))

    expect(repaired.default_agent).toBe('assistant')
    expect(repaired.agent.assistant).toEqual({ mode: 'primary', disable: false })
    expect(repaired.agent.assistant.prompt).toBeUndefined()
    expect(repaired.agent.custom.prompt).toBe('Custom agent')
    expect(repaired.model).toBe('provider/model')
    expect(repaired.skills.paths).toEqual(['.opencode/skills'])
    expect(result.files.opencodeJson?.created).toBe(true)
  })

  it('preserves custom assistant config while making it selectable', async () => {
    await ensureAssistantMode(mockRepo)
    const opencodeJsonPath = path.join(ws.assistantDir, 'opencode.json')
    await writeFile(opencodeJsonPath, JSON.stringify({
      default_agent: 'assistant',
      agent: {
        assistant: {
          mode: 'subagent',
          prompt: 'Custom assistant prompt',
          description: 'Custom assistant',
          permission: { bash: 'ask' },
        },
      },
    }, null, 2))

    const result = await ensureAssistantMode(mockRepo)
    const repaired = JSON.parse(await readFile(opencodeJsonPath, 'utf8'))

    expect(repaired.agent.assistant.prompt).toBe('Custom assistant prompt')
    expect(repaired.agent.assistant.description).toBe('Custom assistant')
    expect(repaired.agent.assistant.permission.bash).toBe('ask')
    expect(repaired.agent.assistant.mode).toBe('primary')
    expect(repaired.agent.assistant.disable).toBe(false)
    expect(result.files.opencodeJson?.created).toBe(true)
  })

  it('migrates generated legacy AGENTS.md and assistant.md to the new split', async () => {
    await ensureAssistantMode(mockRepo)

    const legacyAgentsMd = `# Assistant Mode Instructions

This folder is the shared Assistant mode workspace for OpenCode Manager.

## Purpose

Assistant mode provides an isolated space for:
- Self-editing agent instructions and preferences
- Customized workflows specific to this assistant workspace
- Iterative improvement of assistant behavior

## Self-Editing Rules

The agent MAY self-edit the following files within this workspace:
- \`AGENTS.md\` - Assistant instructions, persona, and durable preferences
- \`opencode.json\` - OpenCode configuration for this workspace

## Constraints

- Changes outside this workspace require explicit user direction
- Self-edits should be concise and auditable
- Preserve user-customized content when modifying files
- Always ask for confirmation before making significant changes

## Guidelines

1. Keep instructions clear and actionable
2. Update AGENTS.md when learning durable preferences
3. Maintain version control awareness
4. Document significant changes in commit messages

## Repo Management

This workspace includes a skill at \`.opencode/skills/repo-management/SKILL.md\` for listing repos available to OpenCode Manager via the internal HTTP API. Load it before the schedule-management skill when you don't know the repo ID.

## Schedule Management

This workspace ships with a workspace-scoped skill at \`.opencode/skills/schedule-management/SKILL.md\` that documents how to list, create, update, delete, run, inspect, and cancel schedule jobs and runs across any repo via the internal HTTP API. Load it whenever the user asks about schedules.

## Notifications

This workspace includes a skill at \`.opencode/skills/notifications/SKILL.md\` for sending push notifications to the user's registered devices via the internal HTTP API. Load it when you need to notify the user about important events.

## Settings Management

This workspace includes a skill at \`.opencode/skills/manager-settings/SKILL.md\` for reading and safely modifying user preferences via the internal HTTP API. Load it when you need to inspect or update UI settings.
`

    const legacyAssistantAgent = `---
description: Default OpenCode Manager assistant workspace agent
mode: primary
permission:
  read: allow
  edit: allow
  glob: allow
  grep: allow
  list: allow
  bash: allow
  external_directory: ask
---

You are the default Assistant Mode agent for OpenCode Manager.

This workspace is the shared assistant workspace. Help the user manage repos, schedules, notifications, settings, and assistant behavior safely.

Use the workspace skills when relevant:
- Load repo-management before schedule-management when you need a repo ID.
- Load schedule-management for schedule jobs and runs.
- Load notifications when the user should be notified about important events.
- Load manager-settings when reading or safely updating UI preferences.

Preserve user-customized workspace files unless the user explicitly asks you to change them.
Ask before destructive operations or changes outside this assistant workspace.
`

    const agentsMdPath = path.join(ws.assistantDir, 'AGENTS.md')
    const opencodeJsonPath = path.join(ws.assistantDir, 'opencode.json')
    const assistantAgentPath = path.join(ws.assistantDir, '.opencode/agents/assistant.md')
    const legacyAssistantPrompt = legacyAssistantAgent.split('---\n\n')[1]?.trimEnd()

    if (legacyAssistantPrompt === undefined) throw new Error('Legacy assistant prompt fixture is invalid')

    await writeFile(agentsMdPath, legacyAgentsMd)
    await writeFile(assistantAgentPath, legacyAssistantAgent)
    await writeFile(opencodeJsonPath, JSON.stringify({
      default_agent: 'assistant',
      instructions: ['AGENTS.md'],
      permission: {
        read: 'allow',
        edit: 'allow',
        glob: 'allow',
        grep: 'allow',
        list: 'allow',
        bash: 'allow',
        external_directory: 'ask',
      },
      agent: {
        assistant: {
          description: 'Default OpenCode Manager assistant workspace agent',
          mode: 'primary',
          prompt: legacyAssistantPrompt,
          permission: {
            read: 'allow',
            edit: 'allow',
            glob: 'allow',
            grep: 'allow',
            list: 'allow',
            bash: 'allow',
            external_directory: 'ask',
          },
        },
      },
    }, null, 2))

    const result = await ensureAssistantMode(mockRepo)

    const updatedAgentsMd = await readFile(agentsMdPath, 'utf8')
    const updatedAssistantAgent = await readFile(assistantAgentPath, 'utf8')
    const updatedOpenCodeJson = JSON.parse(await readFile(opencodeJsonPath, 'utf8'))

    expect(updatedAgentsMd).toContain('Assistant Mode Workspace')
    expect(updatedAgentsMd).toContain('.opencode/agents/assistant.md')
    expect(updatedAgentsMd).not.toContain('Self-Editing Rules')

    expect(updatedAssistantAgent).toContain('Self-Editing')
    expect(updatedAssistantAgent).toContain('/assistant/reload')
    expect(updatedAssistantAgent).toContain('Always ask the user before reloading')
    expect(updatedAssistantAgent).toContain('repo-management')
    expect(updatedAssistantAgent).toContain('schedule-management')
    expect(updatedAssistantAgent).toContain('notifications')
    expect(updatedAssistantAgent).toContain('manager-settings')

    expect(updatedOpenCodeJson.agent.assistant.prompt).toBeUndefined()
    expect(updatedOpenCodeJson.agent.assistant.description).toBeUndefined()
    expect(updatedOpenCodeJson.agent.assistant.permission).toBeUndefined()
    expect(updatedOpenCodeJson.agent.assistant.mode).toBe('primary')

    expect(result.files.agentsMd?.created).toBe(true)
    expect(result.files.opencodeJson?.created).toBe(true)
    expect(result.defaultAgent?.created).toBe(true)
  })

  it('reaches accounts that already ran the generation before the shell was denied', async () => {
    await ensureAssistantMode(mockRepo)
    const assistantAgentPath = path.join(ws.assistantDir, '.opencode/agents/assistant.md')

    // The frontmatter is written out by hand rather than taken from
    // `buildPriorAssistantDefaultAgentMd()`. A fixture built by the very
    // builder under test is a fixture that moves when the builder is broken,
    // which is precisely the mutation this test exists to catch.
    const priorGenerationFile = `---
description: Default OpenCode Manager assistant workspace agent
mode: primary
permission:
  read: allow
  edit: allow
  glob: allow
  grep: allow
  list: allow
  bash: allow
  external_directory: ask
---

${buildPriorAssistantAgentPrompt()}
`
    expect(priorGenerationFile).toBe(buildPriorAssistantDefaultAgentMd())

    await writeFile(assistantAgentPath, priorGenerationFile)

    const result = await ensureAssistantMode(mockRepo)
    const updated = await readFile(assistantAgentPath, 'utf8')

    // Rewritten, not preserved. A file the app does not recognise comes back
    // with `created: false` and its old contents intact - which is exactly the
    // failure this test is here to catch.
    expect(result.defaultAgent?.created).toBe(true)
    // And therefore actually tightened. Without the prior variant this file
    // would hash to nothing, be preserved as "customized", and the account
    // would keep a shell over every other user's files.
    expect(updated).toBe(buildAssistantDefaultAgentMd())
    expect(updated).toContain('bash: deny')
    expect(updated).toContain('external_directory: deny')
  })

  it('still preserves an assistant.md the user genuinely wrote', async () => {
    await ensureAssistantMode(mockRepo)
    const assistantAgentPath = path.join(ws.assistantDir, '.opencode/agents/assistant.md')
    const handWritten = `---
description: My own assistant
mode: primary
---

I only answer in haiku.
`
    await writeFile(assistantAgentPath, handWritten)

    const result = await ensureAssistantMode(mockRepo)

    expect(result.defaultAgent?.created).toBe(false)
    expect(await readFile(assistantAgentPath, 'utf8')).toBe(handWritten)
  })

  it('migrates previous-generation generated AGENTS.md that still mentions the internal token', async () => {
    await ensureAssistantMode(mockRepo)
    const agentsMdPath = path.join(ws.assistantDir, 'AGENTS.md')

    const previousAgentsMd = `# Assistant Mode Workspace

This directory is the shared Assistant Mode workspace for OpenCode Manager.

## Directory Contents

- \`opencode.json\` configures this workspace and selects the default assistant agent.
- \`.opencode/agents/assistant.md\` contains the default assistant agent instructions, behavior, durable preferences, and self-editing rules.
- \`.opencode/skills/\` contains managed workspace skills for repos, schedules, notifications, and settings.
- \`.opencode/internal-token\` is managed by OpenCode Manager for internal API authentication.

Assistant-specific instructions belong in \`.opencode/agents/assistant.md\`.
`
    await writeFile(agentsMdPath, previousAgentsMd)

    const result = await ensureAssistantMode(mockRepo)

    const updatedAgentsMd = await readFile(agentsMdPath, 'utf8')
    expect(updatedAgentsMd).toContain('Assistant Mode Workspace')
    expect(updatedAgentsMd).toContain('.opencode/agents/assistant.md')
    expect(updatedAgentsMd).not.toContain('.opencode/internal-token')
    expect(result.files.agentsMd?.created).toBe(true)
  })

  it('preserves custom AGENTS.md content on subsequent ensureAssistantMode calls', async () => {
    await ensureAssistantMode(mockRepo)
    const agentsMdPath = path.join(ws.assistantDir, 'AGENTS.md')

    const customContent = '# Custom Assistant Workspace\n\nThis is my custom AGENTS.md content.'
    await writeFile(agentsMdPath, customContent)

    const result = await ensureAssistantMode(mockRepo)

    const preservedContent = await readFile(agentsMdPath, 'utf8')
    expect(preservedContent).toBe(customContent)
    expect(result.files.agentsMd?.created).toBe(false)
  })

  it('warns when managed updates apply but customized legacy AGENTS.md is preserved', async () => {
    await ensureAssistantMode(mockRepo)
    const agentsMdPath = path.join(ws.assistantDir, 'AGENTS.md')
    const assistantAgentPath = path.join(ws.assistantDir, '.opencode/agents/assistant.md')

    await writeFile(agentsMdPath, `# Assistant Mode Instructions

This folder is the shared Assistant mode workspace for OpenCode Manager.

## Self-Editing Rules

The agent MAY self-edit the following files within this workspace:
- \`AGENTS.md\` - Assistant instructions, persona, and durable preferences
`)
    await writeFile(assistantAgentPath, `---
description: Default OpenCode Manager assistant workspace agent
mode: primary
permission:
  read: allow
  edit: allow
  glob: allow
  grep: allow
  list: allow
  bash: allow
  external_directory: ask
---

You are the default Assistant Mode agent for OpenCode Manager.

This workspace is the shared assistant workspace. Help the user manage repos, schedules, notifications, settings, and assistant behavior safely.

Use the workspace skills when relevant:
- Load repo-management before schedule-management when you need a repo ID.
- Load schedule-management for schedule jobs and runs.
- Load notifications when the user should be notified about important events.
- Load manager-settings when reading or safely updating UI preferences.

Preserve user-customized workspace files unless the user explicitly asks you to change them.
Ask before destructive operations or changes outside this assistant workspace.
`)

    const result = await ensureAssistantMode(mockRepo)

    const preservedAgentsMd = await readFile(agentsMdPath, 'utf8')
    expect(preservedAgentsMd).toContain('Self-Editing Rules')
    expect(result.files.agentsMd?.created).toBe(false)
    expect(result.defaultAgent?.created).toBe(true)
    expect(result.warnings?.[0]?.code).toBe('assistant-agents-md-preserved')
    expect(result.warnings?.[0]?.message).toContain('manually delete AGENTS.md')
  })

  it('overwrites custom AGENTS.md when overwriteAgentsMd is true', async () => {
    await ensureAssistantMode(mockRepo)
    const agentsMdPath = path.join(ws.assistantDir, 'AGENTS.md')

    const customContent = '# Custom Assistant Workspace\n\nThis is my custom AGENTS.md content.'
    await writeFile(agentsMdPath, customContent)

    const result = await ensureAssistantMode(mockRepo, { overwriteAgentsMd: true })

    const updatedContent = await readFile(agentsMdPath, 'utf8')
    expect(updatedContent).toContain('Assistant Mode Workspace')
    expect(updatedContent).toContain('.opencode/agents/assistant.md')
    expect(updatedContent).not.toBe(customContent)
    expect(result.files.agentsMd?.created).toBe(true)
  })
})

describe('assistant-mode end-to-end', () => {
  let ws: Awaited<ReturnType<typeof createTempAssistantWorkspace>>
  let db: ReturnType<typeof createTestDb>

  beforeEach(async () => {
    ws = await createTempAssistantWorkspace()
    db = createTestDb()
  })
  afterEach(async () => { await ws.cleanup() })

  it('the database internal token authenticates a request to /api/internal/schedules/all', async () => {
    await ensureAssistantMode(mockRepo)

    const token = getOrCreateInternalToken(db)

    const stubWorktreeManager = { prepare: () => Promise.resolve(null), finalize: () => Promise.resolve({ commitHash: null }) } as unknown as ScheduleWorktreeManager
    const scheduleService = new ScheduleService(db, createOpenCodeClient(), stubWorktreeManager)
    const notificationService = new NotificationService(db)
    const settingsService = new SettingsService(db)
    const app = new Hono()
    app.route('/api/internal', createInternalRoutes(db, scheduleService, notificationService, settingsService, createOpenCodeClient()))

    const unauth = await app.request('/api/internal/schedules/all')
    expect(unauth.status).toBe(401)

    const authed = await app.request('/api/internal/schedules/all', {
      headers: { authorization: `Bearer ${token}` },
    })
    expect(authed.status).toBe(200)
    const body = await authed.json() as { jobs: unknown[] }
    expect(Array.isArray(body.jobs)).toBe(true)
  })
})

describe('resetAssistantWorkspace', () => {
  let ws: Awaited<ReturnType<typeof createTempAssistantWorkspace>>

  beforeEach(async () => { ws = await createTempAssistantWorkspace() })
  afterEach(async () => { await ws.cleanup() })

  it('removes what the assistant accumulated and puts the managed files back', async () => {
    await ensureAssistantMode(mockRepo, {}, 'alice')
    const dir = getAssistantModeDirectory('alice')

    // The two things the user actually wants gone: something the assistant
    // downloaded that is not a project, and an agent file it edited into a
    // state the user does not want to keep.
    const stray = path.join(dir, 'RelayAB')
    await mkdir(stray, { recursive: true })
    await writeFile(path.join(stray, 'index.js'), 'console.log(1)')
    await writeFile(path.join(dir, '.opencode/agents/assistant.md'), 'i only speak haiku')

    await resetAssistantWorkspace(mockRepo, 'alice')

    await expect(access(stray)).rejects.toThrow()
    const agent = await readFile(path.join(dir, '.opencode/agents/assistant.md'), 'utf8')
    expect(agent).toContain('bash: deny')
    expect(JSON.parse(await readFile(path.join(dir, 'opencode.json'), 'utf8')).default_agent).toBe('assistant')
    // The skills come back too, otherwise "reset" would leave an assistant
    // that can do nothing at all.
    await access(path.join(dir, '.opencode/skills/repo-management/SKILL.md'))
  })

  it('touches only the account that asked', async () => {
    await ensureAssistantMode(mockRepo, {}, 'alice')
    await ensureAssistantMode(mockRepo, {}, 'bob')

    const bobDir = getAssistantModeDirectory('bob')
    const bobBefore = await readFile(path.join(bobDir, '.opencode/agents/assistant.md'), 'utf8')
    const bobStray = path.join(bobDir, 'his-private-notes')
    await mkdir(bobStray, { recursive: true })
    await writeFile(path.join(bobStray, 'keep.md'), 'do not touch')

    await resetAssistantWorkspace(mockRepo, 'alice')

    // Every user's files live under one OS account here, so nothing but the
    // name in the path separates two assistants. If this ever regresses, one
    // user can wipe another's workspace by pressing one button.
    expect(await readFile(path.join(bobDir, '.opencode/agents/assistant.md'), 'utf8')).toBe(bobBefore)
    expect(await readFile(path.join(bobStray, 'keep.md'), 'utf8')).toBe('do not touch')
  })

})

describe('buildAssistantRepo', () => {
  it('returns the synthetic assistant repo with id 0', () => {
    const repo = buildAssistantRepo()
    expect(repo.id).toBe(0)
    expect(repo.localPath).toBe('assistant')
    expect(repo.cloneStatus).toBe('ready')
    expect(repo.repoUrl).toBeUndefined()
    expect(repo.isWorktree).toBe(false)
  })
})

describe('installAssistantWorkspace', () => {
  let ws: Awaited<ReturnType<typeof createTempAssistantWorkspace>>
  let db: ReturnType<typeof createTestDb>

  beforeEach(async () => {
    ws = await createTempAssistantWorkspace()
    db = createTestDb()
  })
  afterEach(async () => { await ws.cleanup() })

  it('prepares a workspace per account, not only the anonymous one', async () => {
    // Each account has its own assistant directory, so warming only the
    // anonymous one leaves every real user with nothing. That is how the
    // assistant page ended up on its skeleton with the stream disconnected.
    const now = Date.now()
    const insert = db.prepare(
      `INSERT INTO "user" ("id", "name", "email", "username", "role", "emailVerified", "createdAt", "updatedAt")
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    insert.run('u1', 'Alice', 'alice@example.com', 'alice', 'admin', 1, now, now)
    insert.run('u2', 'Bob', 'bob@example.com', 'bob', 'user', 1, now + 1, now + 1)

    await installAssistantWorkspace({ db })

    for (const username of ['alice', 'bob']) {
      // Ask the code where the directory is rather than guessing it again.
      const dir = getAssistantModeDirectory(username)
      const config = await readFile(path.join(dir, 'opencode.json'), 'utf8')
      expect(JSON.parse(config).default_agent, `${username} 的工作区没建出来`).toBe('assistant')
      await access(path.join(dir, '.opencode', 'agents', 'assistant.md'))
    }

    // The anonymous one is what the assistant repo points at, so it stays.
    await access(path.join(ws.assistantDir, 'opencode.json'))
  })

  it('does not invent a directory for an account with no username', async () => {
    const now = Date.now()
    db.prepare(
      `INSERT INTO "user" ("id", "name", "email", "username", "role", "emailVerified", "createdAt", "updatedAt")
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run('u3', 'Nameless', 'nameless@example.com', null, 'user', 1, now, now)

    await installAssistantWorkspace({ db })

    await access(path.join(ws.assistantDir, 'opencode.json'))
  })

  it('provisions the assistant workspace files without contacting OpenCode', async () => {
    const result = await installAssistantWorkspace({ db })

    const opencodeJson = await readFile(path.join(ws.assistantDir, 'opencode.json'), 'utf8')
    expect(JSON.parse(opencodeJson).default_agent).toBe('assistant')

    const agentsMd = await readFile(path.join(ws.assistantDir, 'AGENTS.md'), 'utf8')
    expect(agentsMd).toContain('Assistant Mode Workspace')

    const assistantAgent = await readFile(path.join(ws.assistantDir, '.opencode/agents/assistant.md'), 'utf8')
    expect(assistantAgent).toContain('mode: primary')

    expect(result.files.opencodeJson?.exists).toBe(true)
    expect(result.files.agentsMd?.exists).toBe(true)
    expect(result.defaultAgent?.exists).toBe(true)
    expect(result.repoId).toBe(0)

    const assistantRepo = getRepoById(db, 0)
    expect(assistantRepo?.id).toBe(0)
    expect(assistantRepo?.localPath).toBe('assistant')
    expect(assistantRepo?.fullPath).toBe(ws.assistantDir)
    expect(assistantRepo?.cloneStatus).toBe('ready')
    expect(assistantRepo?.defaultBranch).toBe('main')
  })

  it('repairs an assistant row created with a non-zero id', async () => {
    db.prepare(`
      INSERT INTO repos (
        id,
        repo_url,
        local_path,
        source_path,
        branch,
        default_branch,
        clone_status,
        cloned_at,
        last_accessed_at,
        is_worktree,
        is_local
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(99, null, 'assistant', null, null, 'main', 'ready', Date.now(), Date.now(), 0, 0)
    db.prepare(`
      INSERT INTO schedule_jobs (
        repo_id,
        name,
        description,
        enabled,
        interval_minutes,
        schedule_mode,
        cron_expression,
        timezone,
        agent_slug,
        prompt,
        model,
        skill_metadata,
        created_at,
        updated_at,
        last_run_at,
        next_run_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(99, 'Assistant job', null, 1, 60, 'interval', null, null, null, 'hello', null, null, Date.now(), Date.now(), null, null)

    await installAssistantWorkspace({ db })

    expect(getRepoById(db, 99)).toBeNull()
    const assistantRepo = getRepoById(db, 0)
    expect(assistantRepo?.localPath).toBe('assistant')

    const migratedJob = db.prepare('SELECT repo_id FROM schedule_jobs WHERE name = ?').get('Assistant job') as { repo_id: number }
    expect(migratedJob.repo_id).toBe(0)
  })

  it('is idempotent — second call does not recreate files and content is unchanged', async () => {
    await installAssistantWorkspace({ db })

    const opencodeJsonPath = path.join(ws.assistantDir, 'opencode.json')
    const agentsMdPath = path.join(ws.assistantDir, 'AGENTS.md')
    const assistantAgentPath = path.join(ws.assistantDir, '.opencode/agents/assistant.md')

    const firstContent = {
      opencodeJson: await readFile(opencodeJsonPath, 'utf8'),
      agentsMd: await readFile(agentsMdPath, 'utf8'),
      assistantAgent: await readFile(assistantAgentPath, 'utf8'),
    }

    const result = await installAssistantWorkspace({ db })

    const secondContent = {
      opencodeJson: await readFile(opencodeJsonPath, 'utf8'),
      agentsMd: await readFile(agentsMdPath, 'utf8'),
      assistantAgent: await readFile(assistantAgentPath, 'utf8'),
    }

    expect(secondContent.opencodeJson).toBe(firstContent.opencodeJson)
    expect(secondContent.agentsMd).toBe(firstContent.agentsMd)
    expect(secondContent.assistantAgent).toBe(firstContent.assistantAgent)

    expect(result.files.opencodeJson?.created).toBe(false)
    expect(result.files.agentsMd?.created).toBe(false)
    expect(result.defaultAgent?.created).toBe(false)
  })
})

describe('assistant mode directory contract', () => {
  it('resolves the assistant directory and .opencode directory under the workspace', async () => {
    const ws = await createTempAssistantWorkspace()
    try {
      const { getAssistantModePath, getAssistantOpenCodeDir } = await import('@opencode-manager/shared/config/env')
      const { getAssistantModeDirectory } = await import('../../src/services/assistant-mode')

      expect(getAssistantModeDirectory()).toBe(getAssistantModePath())
      expect(getAssistantOpenCodeDir()).toBe(path.join(ws.assistantDir, '.opencode'))
    } finally {
      await ws.cleanup()
    }
  })
})
