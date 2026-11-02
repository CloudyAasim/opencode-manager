#!/usr/bin/env bun

import { writeFile } from 'fs/promises'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { buildV1JsonSchema } from '../shared/src/api/v1-schema'

const __dirname = dirname(fileURLToPath(import.meta.url))

/**
 * The JSON Schema is what a client that is not written in TypeScript reads.
 * It is generated from the same shapes the backend validates against, so it
 * cannot say anything the API does not say.
 */
async function main() {
  const outputPath = join(__dirname, '../docs/api/v1.schema.json')
  const schema = buildV1JsonSchema()
  await writeFile(outputPath, `${JSON.stringify(schema, null, 2)}\n`, 'utf8')
  console.log(`v1 JSON Schema written to ${outputPath}`)
}

main().catch((error) => {
  console.error('Failed to write the v1 JSON Schema:', error)
  process.exit(1)
})
