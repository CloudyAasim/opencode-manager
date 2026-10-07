import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createProxy } from './proxy.ts'
import { candidateTargets, detectServer } from './detect.ts'

const here = path.dirname(fileURLToPath(import.meta.url))

function flag(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`)
  if (index === -1) return undefined
  return process.argv[index + 1]
}

/**
 * Where the built app lives.
 *
 * In development that is `../frontend/dist` next to this package. In a packaged
 * app it is unpacked beside the executable, and the environment variable is how
 * the packager says so - because `import.meta.url` inside an asar archive points
 * at the archive, not at a directory on disk.
 */
function resolveStaticRoot(explicit?: string): string {
  const candidates = [
    explicit,
    process.env.OCM_STATIC_ROOT,
    path.resolve(here, '..', 'frontend', 'dist'),
    path.resolve(here, '..', '..', 'frontend', 'dist'),
  ].filter((value): value is string => typeof value === 'string' && value.length > 0)

  const found = candidates.find((candidate) => existsSync(path.join(candidate, 'index.html')))
  if (!found) {
    throw new Error(
      `Could not find the built app. Looked in:\n${candidates
        .map((c) => `  ${c}`)
        .join('\n')}\nRun \`pnpm --filter frontend build\` first, or set OCM_STATIC_ROOT.`,
    )
  }
  return found
}

async function main() {
  const explicitTarget = flag('target') ?? process.env.OCM_SERVER_URL
  const staticRoot = resolveStaticRoot(flag('static'))

  let target = explicitTarget?.trim()
  if (!target) {
    process.stdout.write('No server given; looking for one on this machine...\n')
    const found = await detectServer(candidateTargets())
    if (!found) {
      // Not fatal: the proxy starts anyway and the user names a server in the
      // app. Failing here would make "the server is not running yet" look like
      // "the client is broken", and the app has a settings panel for exactly
      // this.
      process.stdout.write(
        '  none found. Start with --target, or choose one in the app.\n',
      )
      target = 'http://127.0.0.1:5551'
    } else {
      target = found.url
      process.stdout.write(`  found ${found.url}${found.version ? ` (v${found.version})` : ''}\n`)
    }
  }

  const proxy = createProxy({ staticRoot, target, secureTransport: false })
  const port = Number(flag('port') ?? process.env.OCM_PROXY_PORT ?? 0)
  const address = await proxy.listen(port)

  process.stdout.write(`\nOpenCode Manager: http://${address.host}:${address.port}\n`)
  process.stdout.write(`  serving  ${staticRoot}\n`)
  process.stdout.write(`  proxying ${proxy.getTarget()}\n\n`)

  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, () => {
      void proxy.close().then(() => process.exit(0))
    })
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
  process.exit(1)
})