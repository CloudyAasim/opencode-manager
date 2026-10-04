export type AssistantAgentPermission = {
  read: 'allow'
  edit: 'allow'
  glob: 'allow'
  grep: 'allow'
  list: 'allow'
  bash: 'allow' | 'deny'
  external_directory: 'ask' | 'deny'
}

/**
 * The permission block as it shipped before the shell was denied, kept so the
 * historical builders in `legacy.ts` can reproduce that file byte for byte.
 *
 * `permission` is a parameter here, and it is a parameter because it used to be
 * an internal `buildAssistantAgentPermission()` call. That looked harmless and
 * was not: the historical builders reconstruct the agent file that is already
 * on disk so the app can recognise its own output and update it. If they
 * rebuild it with today's permission block, the hash matches nothing, and the
 * app concludes the user hand-wrote `assistant.md` and leaves it alone. The
 * defect is invisible until the permission changes - and then it is invisible
 * exactly where it matters most, because the tightening silently fails to
 * reach every account that already existed.
 */
export function buildAssistantDefaultAgentMdFromPrompt(
  prompt: string,
  permission: AssistantAgentPermission = buildAssistantAgentPermission(),
): string {
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
    'If the user asks you to clone, add, or import a repository, say that it should be added from the Projects screen. You cannot add one yourself: the manager API you can reach lists and inspects projects but does not create them, and you have no shell to fall back on. A repository you put in this directory is effectively lost - the app does not list it as a project, and the user cannot delete it from the UI.',
    '',
    'A repository that already sits in the projects directory does become a project on its own, so if the user cloned one by hand it will appear without anyone doing anything.',
    '',
    '## You Have No Shell',
    '',
    'Shell access is denied, deliberately. Every user\'s workspace lives under one shared account, so a shell here would be a shell over every other user\'s files as well.',
    '',
    'Everything you are meant to do goes through the `ocm` tool: projects, schedules, notifications, settings, and reloading yourself. If a request needs something the tool cannot do, say so plainly instead of looking for another way in.',
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
    '- Load `repo-management` to look up a project, or before `schedule-management` when you need a repo ID.',
    '- Load `schedule-management` for schedule jobs and runs.',
    '- Load `notifications` when the user should be notified about important events.',
    '- Load `manager-settings` when reading or safely updating UI preferences.',
  ].join('\n')
}

/**
 * What the default assistant agent is allowed to do.
 *
 * `bash` used to be `allow` and `external_directory` was `ask`. Both were
 * wrong for a shared deployment:
 *
 * - The container runs as a single OS user that owns all of `/workspace`, so
 *   every user's `workspace/` and `setting/` belongs to the same account. A
 *   shell in the assistant's directory is a shell everywhere - one user's
 *   assistant could read and rewrite another user's projects by naming the
 *   path. That is not a theoretical risk; it is what `bash: allow` means here.
 * - `external_directory: ask` only helps when someone is there to answer, and
 *   it covers the read/edit/glob/grep tools rather than the shell, so it did
 *   not close the same door anyway.
 *
 * The assistant's actual job - repos, schedules, notifications, settings - goes
 * through the `ocm` tool, which is an explicit route allowlist rather than a
 * shell. Denying the shell costs it the ability to improvise, which is exactly
 * what produced the cloned-into-the-wrong-directory incident, and it costs the
 * ability to reach a directory that is not the user's own.
 *
 * Scalars rather than a `{ permission, pattern, action }` ruleset: the ruleset
 * form is what scheduled runs use, but the agent definition's handling of it
 * cannot be verified from here, and a permission that silently fails open is
 * worse than a stricter one that is certain to apply.
 */
export function buildAssistantAgentPermission(): AssistantAgentPermission {
  return {
    read: 'allow',
    edit: 'allow',
    glob: 'allow',
    grep: 'allow',
    list: 'allow',
    bash: 'deny',
    external_directory: 'deny',
  }
}

export const PRIOR_ASSISTANT_AGENT_PERMISSION: AssistantAgentPermission = {
  read: 'allow',
  edit: 'allow',
  glob: 'allow',
  grep: 'allow',
  list: 'allow',
  bash: 'allow',
  external_directory: 'ask',
}

export function buildAssistantDefaultAgentMd(): string {
  return buildAssistantDefaultAgentMdFromPrompt(buildAssistantAgentPrompt())
}
