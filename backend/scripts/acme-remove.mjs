import { rm } from 'node:fs/promises'
import path from 'node:path'

const [token] = process.argv.slice(2)

if (!token || !/^[A-Za-z0-9_-]{1,128}$/.test(token)) {
  process.exit(1)
}

const directory = process.env.ACME_CHALLENGE_DIR ?? '/app/data/acme-challenge'

await rm(path.join(directory, token), { force: true })
