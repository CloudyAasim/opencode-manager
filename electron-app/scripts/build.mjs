import { build } from 'esbuild'
import { rm, mkdir, cp } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const dist = path.join(root, 'dist')

await rm(dist, { recursive: true, force: true })
await mkdir(dist, { recursive: true })

// esbuild rather than tsc because the sources import TypeScript from a sibling
// package and resolve a workspace dependency by bare specifier. tsc would need a
// path map plus a rewrite step for the emitted specifiers; esbuild follows the
// real resolution and inlines it, which is what the packaged app needs anyway.
//
// CommonJS on purpose, for the preload more than for the main process: a
// sandboxed preload runs in a context with only a subset of node available and
// does not support ESM, so an ESM preload is not a style question - it does not
// load. The main process gets the same treatment for consistency, and because
// `electron` is a CommonJS module that named ESM imports do not survive.
await build({
  entryPoints: [path.join(root, 'src/main.ts'), path.join(root, 'src/preload.ts')],
  outdir: dist,
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  sourcemap: true,
  // electron is provided by the runtime; bundling it would produce a second,
  // broken copy inside the app.
  external: ['electron'],
})

// The built app has to travel with the desktop bundle, or the window loads a
// directory that does not exist on the user's machine.
const frontendDist = path.resolve(root, '..', 'frontend', 'dist')
try {
  await cp(frontendDist, path.join(dist, 'frontend', 'dist'), { recursive: true })
  console.log('copied the built app into dist/frontend/dist')
} catch {
  console.warn(`no built app at ${frontendDist} - run \`pnpm --filter frontend build\` first`)
}

console.log('built dist/main.js and dist/preload.js')