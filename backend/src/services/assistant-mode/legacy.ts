import { hashContent } from './content'
import { buildAssistantDefaultAgentMdFromPrompt } from './agents-md'
import { buildAssistantAgentsMd } from './agents-md'
import { buildAssistantAgentPrompt } from './agents-md'
import { buildAssistantDefaultAgentMd } from './agents-md'

export function buildLegacyAssistantAgentsMd(): string {
  return `# Assistant Mode Instructions

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
}

export function buildLegacyAssistantAgentPrompt(): string {
  return [
    'You are the default Assistant Mode agent for OpenCode Manager.',
    '',
    'This workspace is the shared assistant workspace. Help the user manage repos, schedules, notifications, settings, and assistant behavior safely.',
    '',
    'Use the workspace skills when relevant:',
    '- Load repo-management before schedule-management when you need a repo ID.',
    '- Load schedule-management for schedule jobs and runs.',
    '- Load notifications when the user should be notified about important events.',
    '- Load manager-settings when reading or safely updating UI preferences.',
    '',
    'Preserve user-customized workspace files unless the user explicitly asks you to change them.',
    'Ask before destructive operations or changes outside this assistant workspace.',
  ].join('\n')
}

export function buildLegacyAssistantDefaultAgentMd(): string {
  return buildAssistantDefaultAgentMdFromPrompt(buildLegacyAssistantAgentPrompt())
}

export function buildPreviousAssistantAgentsMd(): string {
  return `# Assistant Mode Workspace

This directory is the shared Assistant Mode workspace for OpenCode Manager.

## Directory Contents

- \`opencode.json\` configures this workspace and selects the default assistant agent.
- \`.opencode/agents/assistant.md\` contains the default assistant agent instructions, behavior, durable preferences, and self-editing rules.
- \`.opencode/skills/\` contains managed workspace skills for repos, schedules, notifications, and settings.
- \`.opencode/internal-token\` is managed by OpenCode Manager for internal API authentication.

Assistant-specific instructions belong in \`.opencode/agents/assistant.md\`.
`
}

export function matchesGeneratedAssistantAgentsMd(content: string): boolean {
  const currentHash = hashContent(buildAssistantAgentsMd())
  const previousHash = hashContent(buildPreviousAssistantAgentsMd())
  const legacyHash = hashContent(buildLegacyAssistantAgentsMd())
  const contentHash = hashContent(content)
  return contentHash === currentHash || contentHash === previousHash || contentHash === legacyHash
}

export function matchesGeneratedAssistantDefaultAgentMd(content: string): boolean {
  const currentHash = hashContent(buildAssistantDefaultAgentMd())
  const previousHash = hashContent(buildPreviousAssistantDefaultAgentMd())
  const legacyHash = hashContent(buildLegacyAssistantDefaultAgentMd())
  const contentHash = hashContent(content)
  return contentHash === currentHash || contentHash === previousHash || contentHash === legacyHash
}

export function matchesGeneratedAssistantAgentPrompt(content: unknown): content is string {
  if (typeof content !== 'string') return false
  const currentHash = hashContent(buildAssistantAgentPrompt())
  const previousHash = hashContent(buildPreviousAssistantAgentPrompt())
  const legacyHash = hashContent(buildLegacyAssistantAgentPrompt())
  const contentHash = hashContent(content)
  return contentHash === currentHash || contentHash === previousHash || contentHash === legacyHash
}

export function containsLegacyAssistantAgentsGuidance(content: string): boolean {
  return content.includes('## Self-Editing Rules') &&
    content.includes('AGENTS.md') &&
    content.includes('durable preferences')
}

export function buildPreviousAssistantAgentPrompt(): string {
  return [
    'You are the default Assistant Mode agent for OpenCode Manager.',
    '',
    'This workspace is the shared assistant workspace for OpenCode Manager. Help the user manage repos, schedules, notifications, settings, and assistant behavior safely.',
    '',
    '## Self-Editing Rules',
    '',
    'Durable assistant instructions, behavior, and preferences belong in `.opencode/agents/assistant.md`. Edit that file when the user expresses lasting preferences or when you need to refine your behavior.',
    '',
    'The workspace directory explanation belongs in `AGENTS.md`. Keep that file focused on describing the directory contents and pointing to managed files.',
    '',
    'Preserve user-customized workspace files unless the user explicitly asks you to change them. Ask before making significant, destructive, or out-of-workspace changes.',
    '',
    '## Skill Usage',
    '',
    'Use the workspace skills when relevant:',
    '- Load `repo-management` before `schedule-management` when you need a repo ID.',
    '- Load `schedule-management` for schedule jobs and runs.',
    '- Load `notifications` when the user should be notified about important events.',
    '- Load `manager-settings` when reading or safely updating UI preferences.',
  ].join('\n')
}

export function buildPreviousAssistantDefaultAgentMd(): string {
  return buildAssistantDefaultAgentMdFromPrompt(buildPreviousAssistantAgentPrompt())
}
