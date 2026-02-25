import { Database } from 'bun:sqlite'
import { existsSync } from 'fs'
import { homedir, platform } from 'os'
import { join, extname } from 'path'
import { readFileSync } from 'fs'
import { writeFileSync } from 'fs'
import { execSync } from 'child_process'

type MemoryScope = 'convention' | 'decision' | 'context'

interface PluginMemory {
  id: number
  projectId: string
  scope: MemoryScope
  content: string
  filePath: string | null
  accessCount: number
  lastAccessedAt: number | null
  createdAt: number
  updatedAt: number
}

interface ExportOptions {
  format?: 'json' | 'markdown'
  output?: string
  projectId?: string
  scope?: MemoryScope
  limit?: number
  offset?: number
  dbPath?: string
}

interface ImportOptions {
  format?: 'json' | 'markdown'
  projectId: string
  force?: boolean
  dbPath?: string
}

function resolveDefaultDbPath(): string {
  const localPath = join(process.cwd(), '.opencode', 'state', 'opencode', 'memory', 'memory.db')
  if (existsSync(localPath)) {
    return localPath
  }

  const defaultBase = join(homedir(), platform() === 'win32' ? 'AppData' : '.local', 'share')
  const xdgDataHome = process.env['XDG_DATA_HOME'] || defaultBase
  const dataDir = join(xdgDataHome, 'opencode', 'memory')
  return join(dataDir, 'memory.db')
}

function getGitProjectId(): string | null {
  try {
    const repoRoot = execSync('git rev-parse --show-toplevel', { encoding: 'utf-8' }).trim()
    if (!repoRoot) return null

    const repoName = repoRoot.split('/').pop() ?? null
    if (repoName) return repoName

    try {
      const remoteUrl = execSync('git remote get-url origin', { encoding: 'utf-8' }).trim()
      const match = remoteUrl.match(/[:/]([^/.]+)\.git$/)
      if (match) return match[1]
    } catch {
      return null
    }

    return null
  } catch {
    return null
  }
}

function groupBy<T>(arr: T[], keyFn: (item: T) => string): Record<string, T[]> {
  return arr.reduce((acc, item) => {
    const key = keyFn(item)
    if (!acc[key]) acc[key] = []
    acc[key].push(item)
    return acc
  }, {} as Record<string, T[]>)
}

function capitalize(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1)
}

export function formatAsJson(memories: PluginMemory[]): string {
  return JSON.stringify(memories, null, 2)
}

export function formatAsMarkdown(memories: PluginMemory[]): string {
  const byScope = groupBy(memories, (m) => m.scope)
  const lines = [
    '# Memory Export',
    '',
    `Exported on ${new Date().toISOString().split('T')[0]}`,
    '',
  ]

  for (const scope of ['convention', 'decision', 'context'] as const) {
    const items = byScope[scope] || []
    if (items.length === 0) continue

    lines.push(`## ${capitalize(scope)}s (${items.length})`, '')

    for (const m of items) {
      lines.push(
        `### [${m.id}] - Created ${new Date(m.createdAt).toISOString().split('T')[0]}`,
        '',
        m.content,
        ''
      )
    }
  }

  return lines.join('\n')
}

export function parseJsonImport(content: string, projectId: string): PluginMemory[] {
  const data = JSON.parse(content)
  if (!Array.isArray(data)) {
    throw new Error('Invalid JSON format: expected array of memories')
  }

  const now = Date.now()
  return data.map((item: Record<string, unknown>, index: number) => ({
    id: 0,
    projectId: (item.projectId as string) || projectId,
    scope: (item.scope as MemoryScope) || 'context',
    content: item.content as string,
    filePath: (item.filePath as string) || null,
    accessCount: 0,
    lastAccessedAt: null,
    createdAt: (item.createdAt as number) || now,
    updatedAt: (item.updatedAt as number) || now,
  }))
}

export function parseMarkdownImport(content: string, projectId: string): PluginMemory[] {
  const memories: PluginMemory[] = []
  const lines = content.split('\n')
  let currentScope: MemoryScope = 'context'
  let currentContent: string[] = []
  let currentCreatedAt = Date.now()
  let memoryIndex = 0

  const scopePattern = /^##\s+(\w+)(?:s)?\s+\(\d+\)$/i
  const memoryPattern = /^###\s+\[(\d+)\]\s+-\s+Created\s+(\d{4}-\d{2}-\d{2})/

  function saveCurrentMemory() {
    if (currentContent.length > 0) {
      const contentStr = currentContent.join('\n').trim()
      if (contentStr) {
        memories.push({
          id: 0,
          projectId,
          scope: currentScope,
          content: contentStr,
          filePath: null,
          accessCount: 0,
          lastAccessedAt: null,
          createdAt: currentCreatedAt,
          updatedAt: currentCreatedAt,
        })
      }
      currentContent = []
    }
  }

  for (const line of lines) {
    const scopeMatch = line.match(scopePattern)
    if (scopeMatch) {
      saveCurrentMemory()
      const scopeStr = scopeMatch[1].toLowerCase()
      if (scopeStr.startsWith('convention')) {
        currentScope = 'convention'
      } else if (scopeStr.startsWith('decision')) {
        currentScope = 'decision'
      } else {
        currentScope = 'context'
      }
      continue
    }

    const memoryMatch = line.match(memoryPattern)
    if (memoryMatch) {
      saveCurrentMemory()
      memoryIndex++
      try {
        currentCreatedAt = new Date(memoryMatch[2]).getTime()
      } catch {
        currentCreatedAt = Date.now()
      }
      continue
    }

    if (line.startsWith('#') && !line.startsWith('##')) {
      continue
    }

    if (line.trim() || currentContent.length > 0) {
      currentContent.push(line)
    }
  }

  saveCurrentMemory()

  if (memories.length === 0 && content.trim()) {
    const fallbackContent = content
      .replace(/^#.*$/gm, '')
      .replace(/^##.*$/gm, '')
      .replace(/^###.*$/gm, '')
      .trim()

    if (fallbackContent) {
      memories.push({
        id: 0,
        projectId,
        scope: 'context',
        content: fallbackContent,
        filePath: null,
        accessCount: 0,
        lastAccessedAt: null,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      })
    }
  }

  return memories
}

function exportMemories(options: ExportOptions): void {
  let dbPath = options.dbPath || resolveDefaultDbPath()

  if (!existsSync(dbPath)) {
    console.error(`Database not found at ${dbPath}. Run OpenCode first to initialize memories.`)
    process.exit(1)
  }

  const db = new Database(dbPath)

  try {
    const gitProjectId = getGitProjectId()
    const projectId = options.projectId || gitProjectId

    if (!projectId) {
      console.error('Project ID required. Use --project or ensure this is a git repository.')
      process.exit(1)
    }

    const conditions: string[] = ['project_id = ?']
    const params: (string | number)[] = [projectId]

    if (options.scope) {
      conditions.push('scope = ?')
      params.push(options.scope)
    }

    const limit = options.limit ?? 1000
    const offset = options.offset ?? 0

    const query = `
      SELECT id, project_id, scope, content, file_path, access_count, last_accessed_at, created_at, updated_at
      FROM memories
      WHERE ${conditions.join(' AND ')}
      ORDER BY updated_at DESC
      LIMIT ? OFFSET ?
    `

    const rows = db.prepare(query).all(...params, limit, offset) as Array<{
      id: number
      project_id: string
      scope: string
      content: string
      file_path: string | null
      access_count: number
      last_accessed_at: number | null
      created_at: number
      updated_at: number
    }>

    const memories: PluginMemory[] = rows.map((row) => ({
      id: row.id,
      projectId: row.project_id,
      scope: row.scope as MemoryScope,
      content: row.content,
      filePath: row.file_path,
      accessCount: row.access_count,
      lastAccessedAt: row.last_accessed_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }))

    const format = options.format || 'json'
    let output: string

    if (format === 'markdown') {
      output = formatAsMarkdown(memories)
    } else {
      output = formatAsJson(memories)
    }

    if (options.output) {
      writeFileSync(options.output, output, 'utf-8')
      console.log(`Exported ${memories.length} memories to ${options.output}`)
    } else {
      console.log(output)
    }
  } finally {
    db.close()
  }
}

function importMemories(filePath: string, options: ImportOptions): void {
  let dbPath = options.dbPath || resolveDefaultDbPath()

  if (!existsSync(dbPath)) {
    console.error(`Database not found at ${dbPath}. Run OpenCode first to initialize memories.`)
    process.exit(1)
  }

  let content: string

  try {
    content = readFileSync(filePath, 'utf-8')
  } catch {
    console.error(`Failed to read file: ${filePath}`)
    process.exit(1)
  }

  const format = options.format || (extname(filePath).toLowerCase() === '.md' ? 'markdown' : 'json')

  let memories: PluginMemory[]

  try {
    if (format === 'markdown') {
      memories = parseMarkdownImport(content, options.projectId)
    } else {
      memories = parseJsonImport(content, options.projectId)
    }
  } catch (error) {
    console.error(`Failed to parse ${format} file: ${error instanceof Error ? error.message : 'Unknown error'}`)
    process.exit(1)
  }

  if (memories.length === 0) {
    console.log('No memories found to import.')
    process.exit(0)
  }

  const db = new Database(dbPath)

  try {
    let importedCount = 0
    let skippedCount = 0

    for (const memory of memories) {
      memory.projectId = options.projectId

      if (!options.force) {
        const existing = db
          .prepare('SELECT id FROM memories WHERE project_id = ? AND content = ? LIMIT 1')
          .get(options.projectId, memory.content)

        if (existing) {
          skippedCount++
          continue
        }
      }

      const now = Date.now()
      const result = db
        .prepare(
          'INSERT INTO memories (project_id, scope, content, file_path, access_count, last_accessed_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
        )
        .run(
          memory.projectId,
          memory.scope,
          memory.content,
          memory.filePath,
          0,
          null,
          memory.createdAt || now,
          memory.updatedAt || now
        )

      importedCount++
    }

    console.log(`Import complete: ${importedCount} imported, ${skippedCount} skipped`)
  } finally {
    db.close()
  }
}

function parseArgs(args: string[]): { command: string; options: ExportOptions | ImportOptions; filePath?: string } {
  const command = args[0] || 'export'
  const remaining = args.slice(1)

  if (command === 'export') {
    const options: ExportOptions = {}
    let i = 0

    while (i < remaining.length) {
      const arg = remaining[i]

      if (arg === '--format' || arg === '-f') {
        const format = remaining[++i] as 'json' | 'markdown'
        if (format !== 'json' && format !== 'markdown') {
          console.error(`Unknown format '${format}'. Use 'json' or 'markdown'.`)
          process.exit(1)
        }
        options.format = format
      } else if (arg === '--output' || arg === '-o') {
        options.output = remaining[++i]
      } else if (arg === '--project' || arg === '-p') {
        options.projectId = remaining[++i]
      } else if (arg === '--scope' || arg === '-s') {
        const scope = remaining[++i] as MemoryScope
        if (scope !== 'convention' && scope !== 'decision' && scope !== 'context') {
          console.error(`Unknown scope '${scope}'. Use 'convention', 'decision', or 'context'.`)
          process.exit(1)
        }
        options.scope = scope
      } else if (arg === '--limit' || arg === '-l') {
        options.limit = parseInt(remaining[++i], 10)
        if (isNaN(options.limit)) {
          console.error('Invalid limit value')
          process.exit(1)
        }
      } else if (arg === '--offset') {
        options.offset = parseInt(remaining[++i], 10)
        if (isNaN(options.offset ?? 0)) {
          console.error('Invalid offset value')
          process.exit(1)
        }
      } else if (arg === '--db-path') {
        options.dbPath = remaining[++i]
      } else if (arg === '--help' || arg === '-h') {
        printExportHelp()
        process.exit(0)
      } else {
        console.error(`Unknown option: ${arg}`)
        printExportHelp()
        process.exit(1)
      }

      i++
    }

    return { command: 'export', options }
  }

  if (command === 'import') {
    const options: ImportOptions = { projectId: '' }
    let filePath = remaining[0]
    let i = 1

    if (!filePath || filePath.startsWith('-')) {
      console.error('Import requires a file path')
      printImportHelp()
      process.exit(1)
    }

    if (filePath === '-') {
      filePath = '/dev/stdin'
    }

    while (i < remaining.length) {
      const arg = remaining[i]

      if (arg === '--format' || arg === '-f') {
        const format = remaining[++i] as 'json' | 'markdown'
        if (format !== 'json' && format !== 'markdown') {
          console.error(`Unknown format '${format}'. Use 'json' or 'markdown'.`)
          process.exit(1)
        }
        options.format = format
      } else if (arg === '--project' || arg === '-p') {
        options.projectId = remaining[++i]
      } else if (arg === '--force') {
        options.force = true
      } else if (arg === '--db-path') {
        options.dbPath = remaining[++i]
      } else if (arg === '--help' || arg === '-h') {
        printImportHelp()
        process.exit(0)
      } else {
        console.error(`Unknown option: ${arg}`)
        printImportHelp()
        process.exit(1)
      }

      i++
    }

    if (!options.projectId) {
      options.projectId = getGitProjectId() || ''
    }

    if (!options.projectId) {
      console.error('Project ID required. Use --project or ensure this is a git repository.')
      process.exit(1)
    }

    return { command: 'import', options, filePath }
  }

  if (command === '--help' || command === '-h' || command === 'help') {
    printHelp()
    process.exit(0)
  }

  const exportOptions: ExportOptions = {}
  let i = 0

  while (i < args.length) {
    const arg = args[i]

    if (arg === '--format' || arg === '-f') {
      const format = args[++i] as 'json' | 'markdown'
      if (format !== 'json' && format !== 'markdown') {
        console.error(`Unknown format '${format}'. Use 'json' or 'markdown'.`)
        process.exit(1)
      }
      exportOptions.format = format
    } else if (arg === '--output' || arg === '-o') {
      exportOptions.output = args[++i]
    } else if (arg === '--project' || arg === '-p') {
      exportOptions.projectId = args[++i]
    } else if (arg === '--scope' || arg === '-s') {
      const scope = args[++i] as MemoryScope
      if (scope !== 'convention' && scope !== 'decision' && scope !== 'context') {
        console.error(`Unknown scope '${scope}'. Use 'convention', 'decision', or 'context'.`)
        process.exit(1)
      }
      exportOptions.scope = scope
    } else if (arg === '--limit' || arg === '-l') {
      exportOptions.limit = parseInt(args[++i], 10)
      if (isNaN(exportOptions.limit ?? 0)) {
        console.error('Invalid limit value')
        process.exit(1)
      }
    } else if (arg === '--offset') {
      exportOptions.offset = parseInt(args[++i], 10)
      if (isNaN(exportOptions.offset ?? 0)) {
        console.error('Invalid offset value')
        process.exit(1)
      }
    } else if (arg === '--db-path') {
      exportOptions.dbPath = args[++i]
    }

    i++
  }

  return { command: 'export', options: exportOptions }
}

function printHelp(): void {
  console.log(`
OpenCode Memory CLI

Usage:
  bun run src/cli/export.ts <command> [options]

Commands:
  export    Export memories from database (default)
  import    Import memories into database

Examples:
  # Export all memories as markdown (to stdout)
  bun run src/cli/export.ts export

  # Export as JSON to file
  bun run src/cli/export.ts export --format json --output memories.json

  # Export with project filter
  bun run src/cli/export.ts export --project my-project --scope convention

  # Import from JSON
  bun run src/cli/export.ts import memories.json --project my-project

  # Import from Markdown
  bun run src/cli/export.ts import memories.md --project my-project

  # Import with force (skip duplicate detection)
  bun run src/cli/export.ts import memories.json --project my-project --force

Run 'bun run src/cli/export.ts <command> --help' for more information on a command.
  `.trim())
}

function printExportHelp(): void {
  console.log(`
Export memories from the database

Usage:
  bun run src/cli/export.ts export [options]

Options:
  --format, -f <format>    Output format: json or markdown (default: json)
  --output, -o <file>      Output file path (prints to stdout if not specified)
  --project, -p <id>       Project ID to filter by (auto-detected from git if not provided)
  --scope, -s <scope>      Filter by scope: convention, decision, or context
  --limit, -l <n>          Limit number of memories (default: 1000)
  --offset <n>             Offset for pagination (default: 0)
  --db-path <path>         Path to database file
  --help, -h               Show this help message
  `.trim())
}

function printImportHelp(): void {
  console.log(`
Import memories into the database

Usage:
  bun run src/cli/export.ts import <file> [options]

Arguments:
  <file>                   Input file path (use '-' for stdin)

Options:
  --format, -f <format>    Input format: json or markdown (auto-detected from extension)
  --project, -p <id>       Project ID to assign memories to (required, auto-detected from git)
  --force                  Skip duplicate detection and import all memories
  --db-path <path>         Path to database file
  --help, -h               Show this help message
  `.trim())
}

function runCli(): void {
  const [cmd, ...args] = process.argv.slice(2)

  if (!cmd || cmd === 'help') {
    printHelp()
    process.exit(0)
  }

  if (cmd === 'export' || cmd === 'import') {
    const parsed = parseArgs([cmd, ...args])
    const { command, options, filePath } = parsed

    if (command === 'export') {
      exportMemories(options as ExportOptions)
    } else if (filePath) {
      importMemories(filePath, options as ImportOptions)
    }
  } else if (cmd === '--help' || cmd === '-h') {
    printHelp()
    process.exit(0)
  } else {
    const parsed = parseArgs([cmd, ...args])
    const { command: defaultCommand, options: exportOptions } = parsed

    if (defaultCommand === 'export') {
      exportMemories(exportOptions as ExportOptions)
    }
  }
}

const isMain = typeof import.meta.url === `file://${process.argv[1]}`.replace(/\\/g, '/') || process.argv[1]?.includes('export.ts')

if (isMain || process.argv[1]?.endsWith('export.ts')) {
  runCli()
}
