import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

const [token, content] = process.argv.slice(2)

if (!token || !content || !/^[A-Za-z0-9_-]{1,128}$/.test(token)) {
  process.exit(1)
}

const directory = process.env.ACME_CHALLENGE_DIR ?? '/app/data/acme-challenge'

await mkdir(directory, { recursive: true })
await writeFile(path.join(directory, token), content, 'utf-8')
