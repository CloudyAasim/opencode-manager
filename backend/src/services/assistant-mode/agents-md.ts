export function buildAssistantDefaultAgentMdFromPrompt(prompt: string): string {
  const permission = buildAssistantAgentPermission()

  return `---
description: Default OpenCode Manager assistant workspace agent
mode: primary
permission:
  read: ${permission.read}
  edit: ${permission.edit}
  glob: ${permission.glob}
  grep: ${permission.grep}
  list: ${permission.list}
  bash: ${permission.bash}
  external_directory: ${permission.external_directory}
---

${prompt}
`
}

export function buildAssistantAgentsMd(): string {
  return `# Assistant Mode Workspace

This directory is the shared Assistant Mode workspace for OpenCode Manager. It
holds assistant configuration only - it is not the projects directory.

## Directory Contents

- \`opencode.json\` configures this workspace and selects the default assistant agent.
- \`.opencode/agents/assistant.md\` contains the default assistant agent instructions, behavior, durable preferences, and self-editing rules.
- \`.opencode/skills/\` contains managed workspace skills for repos, schedules, notifications, and settings.

Assistant-specific instructions belong in \`.opencode/agents/assistant.md\`.

Projects do not belong here. Load the \`repo-management\` skill to add one; it
clones into the user's projects directory and registers the result. A repository
cloned into this directory is not shown as a project and cannot be deleted from
the app.
`
}

export function buildAssistantAgentPrompt(): string {
  return [
    'You are the default Assistant Mode agent for OpenCode Manager.',
    '',
    'This workspace is the shared assistant workspace for OpenCode Manager. Help the user manage repos, schedules, notifications, settings, and assistant behavior safely.',
    '',
    '## This Directory Is Not Where Projects Go',
    '',
    'This directory holds assistant configuration and nothing else. The user\'s projects live in a separate projects directory, and they reach it through the app, not through the filesystem.',
    '',
    'When the user asks you to clone, add, or import a repository, load the `repo-management` skill and call `POST /repos`. Do not run `git clone` in a shell, and never clone into this directory.',
    '',
    'A repository cloned here is effectively lost: the app does not list it as a project, the file browser does not reach this directory, and the user has no way to delete it. That is the failure this rule exists to prevent - it has already happened.',
    '',
    '## Self-Editing Rules',
    '',
    'Durable assistant instructions, behavior, and preferences belong in `.opencode/agents/assistant.md`. Edit that file when the user expresses lasting preferences or when you need to refine your behavior.',
    '',
    'The workspace directory explanation belongs in `AGENTS.md`. Keep that file focused on describing the directory contents and pointing to managed files.',
    '',
    'Preserve user-customized workspace files unless the user explicitly asks you to change them. Ask before making significant, destructive, or out-of-workspace changes.',
    '',
    'After editing `.opencode/agents/assistant.md`, load `manager-settings` and call `POST /assistant/reload` to apply changes. Always ask the user before reloading.',
    '',
    '## Skill Usage',
    '',
    'Use the workspace skills when relevant:',
    '- Load `repo-management` to add a project, or before `schedule-management` when you need a repo ID.',
    '- Load `schedule-management` for schedule jobs and runs.',
    '- Load `notifications` when the user should be notified about important events.',
    '- Load `manager-settings` when reading or safely updating UI preferences.',
  ].join('\n')
}

export function buildAssistantAgentPermission(): { read: 'allow'; edit: 'allow'; glob: 'allow'; grep: 'allow'; list: 'allow'; bash: 'allow'; external_directory: 'ask' } {
  return {
    read: 'allow',
    edit: 'allow',
    glob: 'allow',
    grep: 'allow',
    list: 'allow',
    bash: 'allow',
    external_directory: 'ask',
  }
}

export function buildAssistantDefaultAgentMd(): string {
  return buildAssistantDefaultAgentMdFromPrompt(buildAssistantAgentPrompt())
}
