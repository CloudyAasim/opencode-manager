#!/usr/bin/env bun
import { Database } from 'bun:sqlite'
import { listRepos } from './backend/src/db/queries'
import { getReposPath } from './shared/src/config/env'
import path from 'path'
import { exec } from 'child_process'
import { promisify } from 'util'

const execAsync = promisify(exec)

async function checkGitConfig(repoPath: string) {
  try {
    const localEmail = await execAsync('git config user.email', { cwd: repoPath })
    const localName = await execAsync('git config user.name', { cwd: repoPath })
    return {
      localEmail: localEmail.stdout.trim(),
      localName: localName.stdout.trim(),
      source: 'local'
    }
  } catch (error) {
    try {
      const globalEmail = await execAsync('git config --global user.email')
      const globalName = await execAsync('git config --global user.name')
      return {
        localEmail: globalEmail.stdout.trim(),
        localName: globalName.stdout.trim(),
        source: 'global'
      }
    } catch {
      return {
        localEmail: 'NOT SET',
        localName: 'NOT SET',
        source: 'none'
      }
    }
  }
}

async function main() {
  const dbPath = process.env.DATABASE_PATH || './data/opencode.db'
  console.log(`Checking git config for repos in database: ${dbPath}\n`)

  const db = new Database(dbPath)
  const repos = listRepos(db)
  const reposPath = getReposPath()

  console.log(`Found ${repos.length} repos\n`)

  for (const repo of repos) {
    const fullRepoPath = path.resolve(reposPath, repo.localPath)
    const config = await checkGitConfig(fullRepoPath)

    console.log(`Repo: ${repo.localPath}`)
    console.log(`  Path: ${fullRepoPath}`)
    console.log(`  User Email: ${config.localEmail}`)
    console.log(`  User Name: ${config.localName}`)
    console.log(`  Source: ${config.source}`)
    console.log('---')
  }
}

main().catch(console.error)