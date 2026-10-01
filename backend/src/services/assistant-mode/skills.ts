import { ASSISTANT_NOTIFICATION_LIMITS } from '@opencode-manager/shared/schemas'
import { MANAGER_TOOL_NAME } from '../opencode-manager-tool-plugin'

export function buildSchedulesSkill(): string {
  return `---
name: schedule-management
description: Manage schedule jobs and runs across any repo with the ${MANAGER_TOOL_NAME} tool
---

## When to Load

Load this skill when the user asks about managing schedules, schedule jobs, schedule runs, or anything related to automated task execution across repos.

## Tool

Use the \`${MANAGER_TOOL_NAME}\` tool with the \`request\` action. The tool runs inside OpenCode Manager, so it needs no token, no base URL, and no network access from the shell. It works the same in a normal session and a scheduled run. Paths are relative to the internal API (for example \`/schedules/all\` or \`/repos/0/schedules\`) and query strings are allowed.

**Arguments:**
\`\`\`ts
{
  action: 'request',
  params: {
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
    path: string   // relative internal API path; query strings allowed
    body?: object  // JSON body for POST and PATCH routes
  }
}
\`\`\`

## Assistant Schedules

Use repo ID \`0\` for the built-in Assistant. For example, use \`/repos/0/schedules\` to list or create schedule jobs that run in the Assistant workspace.

## Endpoints

### GET /schedules/all
List all schedule jobs across all repos.

\`\`\`json
{
  "action": "request",
  "params": {
    "method": "GET",
    "path": "/schedules/all"
  }
}
\`\`\`

### GET /schedules/all/runs
List all schedule runs across all repos with optional filtering.

Query params: \`limit\`, \`offset\`, \`status\`, \`repoId\`, \`jobId\`, \`triggerSource\`

\`\`\`json
{
  "action": "request",
  "params": {
    "method": "GET",
    "path": "/schedules/all/runs?limit=20"
  }
}
\`\`\`

### GET /repos/:repoId/schedules
List all schedule jobs for a specific repo.

\`\`\`json
{
  "action": "request",
  "params": {
    "method": "GET",
    "path": "/repos/:repoId/schedules"
  }
}
\`\`\`

### POST /repos/:repoId/schedules
Create a new schedule job.

Body matches \`CreateScheduleJobRequest\` schema (discriminated union with \`scheduleMode: 'interval' | 'cron'\`).

\`\`\`json
{
  "action": "request",
  "params": {
    "method": "POST",
    "path": "/repos/:repoId/schedules",
    "body": {
      "name": "my-job",
      "prompt": "do something",
      "scheduleMode": "interval",
      "intervalMinutes": 60
    }
  }
}
\`\`\`

### GET /repos/:repoId/schedules/:jobId
Get a specific schedule job.

\`\`\`json
{
  "action": "request",
  "params": {
    "method": "GET",
    "path": "/repos/:repoId/schedules/:jobId"
  }
}
\`\`\`

### PATCH /repos/:repoId/schedules/:jobId
Update an existing schedule job.

Body matches \`UpdateScheduleJobRequest\` schema.

\`\`\`json
{
  "action": "request",
  "params": {
    "method": "PATCH",
    "path": "/repos/:repoId/schedules/:jobId",
    "body": {
      "enabled": false
    }
  }
}
\`\`\`

### DELETE /repos/:repoId/schedules/:jobId
Delete a schedule job.

\`\`\`json
{
  "action": "request",
  "params": {
    "method": "DELETE",
    "path": "/repos/:repoId/schedules/:jobId"
  }
}
\`\`\`

### POST /repos/:repoId/schedules/:jobId/run
Manually trigger a schedule job.

\`\`\`json
{
  "action": "request",
  "params": {
    "method": "POST",
    "path": "/repos/:repoId/schedules/:jobId/run"
  }
}
\`\`\`

### GET /repos/:repoId/schedules/:jobId/runs
List runs for a specific job.

Query params: \`limit\`

\`\`\`json
{
  "action": "request",
  "params": {
    "method": "GET",
    "path": "/repos/:repoId/schedules/:jobId/runs?limit=20"
  }
}
\`\`\`

### GET /repos/:repoId/schedules/:jobId/runs/:runId
Get a specific schedule run.

\`\`\`json
{
  "action": "request",
  "params": {
    "method": "GET",
    "path": "/repos/:repoId/schedules/:jobId/runs/:runId"
  }
}
\`\`\`

### POST /repos/:repoId/schedules/:jobId/runs/:runId/cancel
Cancel a running schedule run.

\`\`\`json
{
  "action": "request",
  "params": {
    "method": "POST",
    "path": "/repos/:repoId/schedules/:jobId/runs/:runId/cancel"
  }
}
\`\`\`

## Safety

Always confirm destructive operations (\`DELETE\` jobs, \`cancel\` runs) with the user before executing.
`
}

export function buildNotificationsSkill(): string {
  return `---
name: notifications
description: Send push notifications to the user's registered devices with the ${MANAGER_TOOL_NAME} tool
---

## When to Load

Load this skill when you need to notify the user about important events, completed tasks, or questions that require their attention.

## Tool

Use the \`${MANAGER_TOOL_NAME}\` tool with the \`send_notification\` action. The tool runs inside OpenCode Manager, so it needs no token, no base URL, and no network access from the shell. It works the same in a normal session and a scheduled run.

The tool declares its arguments as a typed schema, so the editor and the model both see the exact shape and the tool call is rejected before it runs if it does not match.

**Arguments:**
\`\`\`ts
{
  action: 'send_notification',
  params: {
    title: string       // 1-${ASSISTANT_NOTIFICATION_LIMITS.TITLE_MAX} characters
    body: string        // 1-${ASSISTANT_NOTIFICATION_LIMITS.BODY_MAX} characters
    url?: string        // Optional: deep link to navigate to (1-${ASSISTANT_NOTIFICATION_LIMITS.URL_MAX} chars)
    tag?: string        // Optional: notification tag for deduplication (max ${ASSISTANT_NOTIFICATION_LIMITS.TAG_MAX} chars)
    priority?: 'normal' | 'high'  // Defaults to 'normal'
  }
}
\`\`\`

**Example:**
\`\`\`json
{
  "action": "send_notification",
  "params": {
    "title": "Task Complete",
    "body": "The build has finished successfully",
    "url": "/repos/my-repo",
    "priority": "high"
  }
}
\`\`\`

The tool reports how many devices the notification was delivered to, and says so explicitly when the user has no registered devices.

## Rate Limiting

Sending is rate limited to **10 notifications per minute**. Beyond that the tool fails with a \`429\` status; wait before retrying.

## Notes

- Notifications are only sent if the user has registered devices (browser push subscriptions)
- If VAPID is not configured on the server, the tool fails with a \`503\` status
- Use \`priority: 'high'\` for urgent notifications that should interrupt the user
- Do not call the internal HTTP API with \`curl\` for notifications; the tool is the supported path
`
}

export function buildSettingsSkill(): string {
  return `---
name: manager-settings
description: Read and modify safe user preferences and the OpenCode configuration file with the ${MANAGER_TOOL_NAME} tool
---

## When to Load

Load this skill when you need to inspect or update the user's UI preferences, theme, mode, or other non-sensitive settings.

## Tool

Use the \`${MANAGER_TOOL_NAME}\` tool with the \`request\` action. The tool runs inside OpenCode Manager, so it needs no token, no base URL, and no network access from the shell. It works the same in a normal session and a scheduled run. Paths are relative to the internal API (for example \`/settings\` or \`/assistant/reload\`) and query strings are allowed.

**Arguments:**
\`\`\`ts
{
  action: 'request',
  params: {
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
    path: string   // relative internal API path; query strings allowed
    body?: object  // JSON body for POST and PATCH routes
  }
}
\`\`\`

## Endpoints

### GET /settings

Retrieve the user's full settings, including all preferences.

**Query Parameters:**
- \`userId\` (optional): User ID. Defaults to \`"default"\`.

**Example:**
\`\`\`json
{
  "action": "request",
  "params": {
    "method": "GET",
    "path": "/settings?userId=default"
  }
}
\`\`\`

**Response:**
\`\`\`ts
{
  preferences: {
    theme: 'dark' | 'light' | 'system',
    mode: 'plan' | 'build',
    defaultModel?: string,
    defaultAgent?: string,
    autoScroll: boolean,
    expandDiffs: boolean,
    expandToolCalls: boolean,
    showReasoning: boolean,
    simpleChatMode: boolean,
    leaderKey?: string,
    directShortcuts?: string[],
    keyboardShortcuts: Record<string, string>,
    customCommands: Array<{ name: string; description: string; promptTemplate: string }>,
    notifications?: { enabled: boolean; ... },
    repoOrder?: number[],
    repoSortMode: 'recent' | 'manual' | 'name',
  },
  updatedAt: number
}
\`\`\`

### PATCH /settings

Update a subset of safe user preferences.

**Allowed Keys:**
The following preference keys can be modified:
- \`theme\`, \`mode\`, \`defaultModel\`, \`defaultAgent\`
- \`autoScroll\`, \`expandDiffs\`, \`expandToolCalls\`, \`showReasoning\`
- \`simpleChatMode\`, \`leaderKey\`, \`directShortcuts\`
- \`keyboardShortcuts\`, \`customCommands\`, \`notifications\`
- \`repoOrder\`, \`repoSortMode\`
- \`tts\` — Non-secret TTS preferences (\`enabled\`, \`provider\`, \`autoPlay\`, \`voice\`, \`model\`, \`speed\`). TTS must already be configured in the UI (the endpoint returns 400 otherwise).
- \`stt\` — Non-secret STT preferences (\`enabled\`, \`provider\`, \`model\`, \`language\`). STT must already be configured in the UI (the endpoint returns 400 otherwise).

**DO NOT attempt to set:**
- \`gitCredentials\` - Git credentials must be managed via the full UI
- \`gitIdentity\` - Git identity must be managed via the full UI
- \`tts.apiKey\` - TTS credentials must be managed via the full UI
- \`tts.endpoint\` - TTS endpoint must be managed via the full UI
- \`stt.apiKey\` - STT credentials must be managed via the full UI
- \`stt.endpoint\` - STT endpoint must be managed via the full UI
- \`lastKnownGoodConfig\` - Internal state, do not modify
- Any other keys not in the allowed list above

**Request Body:**
Partial object with any of the allowed keys.

**Example:**
\`\`\`json
{
  "action": "request",
  "params": {
    "method": "PATCH",
    "path": "/settings?userId=default",
    "body": {
      "theme": "dark",
      "mode": "build"
    }
  }
}
\`\`\`

**Response:**
Returns the updated settings object with the same structure as GET.

### POST /assistant/reload

Reload the assistant workspace by disposing the current OpenCode instance. Use this after editing \`.opencode/agents/assistant.md\` or \`opencode.json\` so changes take effect on the next message.

**Note:** Always confirm with the user before reloading, as it re-bootstraps the workspace.

**Rate Limiting:** 5 requests per minute per token. Returns \`429 Too Many Requests\` with \`Retry-After\` header when exceeded.

**Example:**
\`\`\`json
{
  "action": "request",
  "params": {
    "method": "POST",
    "path": "/assistant/reload"
  }
}
\`\`\`

**Response:**
\`\`\`ts
{ "success": true }
\`\`\`

## OpenCode Configuration

The global configuration files on disk are the source of truth. Use the \`ocm\` tool's \`request\` action with the endpoints below to read or change them; never edit the files directly. Global sources merge in order: \`config.json\`, \`opencode.json\`, then \`opencode.jsonc\`.

### GET /opencode-config

Read the merged persisted global configuration and its source files. Returns \`404\` when no source exists. This is not the running instance configuration: project overrides and expanded environment values are not included. \`GET /opencode-config/effective\` reads the running server's effective global configuration separately; never copy that response into a save.

**Response (\`OpenCodeConfigFile\`):**
\`\`\`ts
{
  path: string
  content: object
  rawContent: string
  sources: Array<{ name: string, path: string, rawContent: string, content: object, isValid: boolean }>
  revision: string
  isValid: boolean
  validationIssues?: Array<{ path: string, message: string }>
  updatedAt: number
}
\`\`\`

**Example:**
\`\`\`json
{
  "action": "request",
  "params": {
    "method": "GET",
    "path": "/opencode-config"
  }
}
\`\`\`

### PUT /opencode-config

Read the merged persisted configuration first, change only the keys the user asked for, and send the complete object back with its revision. Only changed fields are patched into the preferred existing source: JSONC, JSON, then legacy config.json. New installations use opencode.jsonc. Unchanged inherited values and comments are preserved. Removing a field removes only its override in the write target; a lower-priority value can reappear.

For a raw edit, send a string with the exact source name from \`sources\`. Never send merged JSON as raw source text. A \`409\` means the source files changed: read again and reconcile rather than retrying stale content.

**Request Body:**
\`\`\`ts
{ content: object | string, expectedRevision: string, source?: "config.json" | "opencode.json" | "opencode.jsonc" }
\`\`\`

**Example:**
\`\`\`json
{
  "action": "request",
  "params": {
    "method": "PUT",
    "path": "/opencode-config",
    "body": {
      "expectedRevision": "revision-from-get",
      "content": {
        "theme": "dark"
      }
    }
  }
}
\`\`\`

**Response:**
Returns the refreshed merged configuration and source files. Adds \`restartRequired: true\` for semantic configuration changes, except changes limited to \`mcp\`, which are saved without it; to make an MCP change take effect immediately, tell the user to reconnect or reload the server from Settings → MCP. Comment-only changes do not require a restart. Saving never silently drops unsupported fields.

Returns \`400\` for invalid configuration and \`409\` for a stale revision.

When the response contains \`restartRequired: true\`, tell the user to restart the OpenCode server from Settings. Never attempt the restart yourself: it would terminate your own session.

## Safety

- The settings PATCH endpoint rejects any attempt to modify credentials, API keys, or other sensitive settings; guide the user to the full UI for Git, TTS, and STT credentials
- PUT /opencode-config patches changed global settings, including \`plugin\`, \`mcp\`, and \`provider\` entries; change only the keys the user explicitly asked for and never add plugins, MCP servers, or provider credentials the user did not request
- The settings PATCH endpoint does NOT trigger OpenCode reload or restart
`
}

export function buildReposSkill(): string {
  return `---
name: repo-management
description: List repos available to OpenCode Manager with the ${MANAGER_TOOL_NAME} tool
---

## When to Load

Load this skill when you need to discover repos, look up repo IDs, or need to reference repo information before managing schedules. Load it before the schedule-management skill if you don't know the repo ID.

## Tool

Use the \`${MANAGER_TOOL_NAME}\` tool with the \`request\` action. The tool runs inside OpenCode Manager, so it needs no token, no base URL, and no network access from the shell. It works the same in a normal session and a scheduled run. Paths are relative to the internal API (for example \`/repos\` or \`/repos/0/schedules\`) and query strings are allowed.

**Arguments:**
\`\`\`ts
{
  action: 'request',
  params: {
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
    path: string   // relative internal API path; query strings allowed
    body?: object  // JSON body for POST and PATCH routes
  }
}
\`\`\`

## Endpoints

### GET /repos

List all repos available to OpenCode Manager. The repos are returned in the order configured by the user (respecting \`repoOrder\` preference).

**Example:**
\`\`\`json
{
  "action": "request",
  "params": {
    "method": "GET",
    "path": "/repos"
  }
}
\`\`\`

**Response:**
\`\`\`ts
{
  repos: Array<{
    id: number          // Use as :repoId in other endpoints
    repoUrl?: string   // Git remote URL if cloned
    localPath: string  // Relative path under repos root
    fullPath: string   // Absolute local path
    sourcePath?: string // Source path for worktrees
    branch?: string    // Current branch (not always available)
    defaultBranch: string
    cloneStatus: 'cloning' | 'ready' | 'error'
    clonedAt: number   // Unix timestamp
    lastPulled?: number
    lastAccessedAt?: number
    isWorktree?: boolean
    isLocal?: boolean
  }>
}
\`\`\`

## Notes

- Use \`id\` as \`:repoId\` in other API endpoints (e.g., \`/repos/:repoId/schedules\`)
- \`fullPath\` is the absolute local path - use it for file operations
- This endpoint is read-only - there are no POST/PUT/DELETE operations for repos
- \`currentBranch\` is not included in the response - it requires git operations to determine
- Repo order is controlled by the \`repoOrder\` preference in settings
`
}
