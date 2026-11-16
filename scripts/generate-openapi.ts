#!/usr/bin/env bun

import { writeFile } from 'fs/promises'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))

const API_URL = process.env.VITE_API_URL || 'http://localhost:8001'
const OPENCODE_URL = API_URL + '/api/opencode'

async function generateOpenAPISpec() {
  console.log(`📥 Fetching OpenAPI spec from ${OPENCODE_URL}/doc`)
  
  try {
    const response = await fetch(`${OPENCODE_URL }/doc`, {
      headers: {
        'Accept': 'application/json'
      }
    })
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`)
    }
    
    const spec = await response.json()
    const outputPath = join(__dirname, 'opencode-spec.json')
    
    await writeFile(outputPath, JSON.stringify(spec, null, 2))
    console.log(`✅ OpenAPI spec saved to ${outputPath}`)
    
    return outputPath
  } catch (error) {
    console.error('❌ Failed to fetch OpenAPI spec:', error)
    console.error('\n💡 Make sure an OpenCode server is running.')
    console.error('   You can start one by opening a repo in the WebUI.')
    process.exit(1)
  }
}

async function main() {
  console.log('🚀 Recording the OpenCode API description...\n')

  const specPath = await generateOpenAPISpec()

  console.log(`\n✨ Done. The description of the agent's API is at ${specPath}`)
  console.log('   The frontend does not get a copy of it any more: the shapes it')
  console.log('   needs are the versioned ones, and a copy of the agent\'s words in')
  console.log('   the client is how the client learned to speak two dialects.')
}

main()
