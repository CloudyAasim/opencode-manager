// Regenerate `proxy/src/test/resources/server-url-golden.tsv` from the real
// TypeScript implementation.
//
// The Kotlin client normalizes a server address exactly as
// `shared/src/utils/server-url.ts` does, because the browser, the desktop client
// and the Android client all read the same stored preference. "Exactly as" is
// not something to be trusted: both are real code and both will drift. Running
// this writes down what the TypeScript actually returns for a list of awkward
// inputs, and `ServerUrlParityTest` then fails if the Kotlin disagrees.
//
// Usage, from the repository root:
//   node --experimental-strip-types android/tools/gen-server-url-cases.mjs
//
// `--experimental-strip-types` is Node 22.6+. The module is TypeScript source,
// because that is how this monorepo consumes `shared` - there is no build step
// to point at. Node 24 needs no flag.
import { writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const sourcePath = resolve(process.argv[2] ?? resolve(here, '../../shared/src/utils/server-url.ts'))
const outputPath = resolve(here, '../proxy/src/test/resources/server-url-golden.tsv')

const { normalizeServerUrl, joinServerUrl } = await import(pathToFileURL(sourcePath).href)

/**
 * The awkward half of "what a person might type into a server box".
 *
 * Bare hosts, schemes, default and non-default ports, sub-path mounts, the
 * application's own `/api` prefix, model and voice endpoints pasted out of a
 * config panel, IPv4 and IPv6 literals, a LAN hostname with an underscore,
 * credentials, nonsense, and the empty string. Each one that behaves differently
 * between the two implementations is a person who types that and lands on the
 * wrong server on one platform.
 */
const inputs = [
  'code.aasim.l.cd',
  'https://code.aasim.l.cd',
  'https://code.aasim.l.cd/',
  'https://code.aasim.l.cd///',
  'code.aasim.l.cd/',
  '  code.aasim.l.cd  ',
  'HTTP://Code.Example.COM',
  'http://localhost:3000',
  'http://192.168.1.10:5551',
  'http://127.0.0.1:8080/base/',
  'https://example.com/opencode-manager',
  'https://example.com/api',
  'https://example.com/api/',
  'https://example.com/api/health',
  'https://example.com/api/v1/models',
  'https://example.com/api/v1/openai/voices',
  'https://example.com/v1/chat/completions',
  'https://example.com/api/speech',
  'https://example.com/api/transcriptions',
  'https://example.com/api/audio/speech',
  'https://example.com/api-manager',
  'https://example.com/apifoo',
  'https://example.com/api-manager/v2/health',
  'https://example.com/?q=1',
  'https://example.com/api/health?token=abc#frag',
  'https://example.com/api/health#frag',
  'https://example.com/V1/Models',
  'ftp://example.com',
  'javascript:alert(1)',
  'file:///etc/passwd',
  'not a url',
  'https://',
  '://example.com',
  '/just/a/path',
  'my_box.local:3000',
  'http://[::1]:3000',
  'https://[2001:db8::1]/api/health',
  '',
  '   ',
  '/',
  '//',
  'https://user:pw@example.com',
  'https://example.com:443',
  'http://example.com:80',
  'https://example.com:8443',
  // Out of range ports. `normalizeServerUrl` hands back anything it cannot
  // parse, unchanged, so these cannot be told apart by the normalization test -
  // `ServerUrlTargetTest` is where the difference shows.
  'http://example.com:99999',
  'http://example.com:0',
  'http://example.com:70000',
  'https://example.com/a/b/c',
  'https://example.com/api/models/v2/voices',
]

const joins = [
  ['https://example.com', '/api/health'],
  ['https://example.com/', 'api/health'],
  ['', '/api/health'],
  ['https://example.com/base/', '/api/health'],
]

const escape = (value) =>
  value.replace(/\\/g, '\\\\').replace(/\t/g, '\\t').replace(/\r/g, '\\r').replace(/\n/g, '\\n')

const lines = [
  '# Recorded from shared/src/utils/server-url.ts.',
  '# Regenerate with: node --experimental-strip-types android/tools/gen-server-url-cases.mjs',
  '#',
  '# Normalisation is shared by the browser, the desktop client and the Android',
  '# client. A disagreement here is not a cosmetic difference between two',
  '# functions: it is a person who types that address getting a different server',
  '# depending on which client they opened. So this file is a contract.',
  '#',
  '# TSV rather than JSON so a reviewer can read the diff and see which behaviour',
  '# moved, and so the test needs no JSON parser to consume it.',
  '# columns: normalize input \\t normalized output',
  ...inputs.map((input) => `${escape(input)}\t${escape(normalizeServerUrl(input))}`),
  '# columns: join base \\t join path \\t joined',
  ...joins.map(([base, path]) => `${escape(base)}\t${escape(path)}\t${escape(joinServerUrl(base, path))}`),
]

writeFileSync(outputPath, lines.join('\n') + '\n')
console.log(`wrote ${inputs.length} normalize cases and ${joins.length} join cases to ${outputPath}`)