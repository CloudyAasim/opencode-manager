import { createHash } from 'node:crypto'

export function hashContent(content: string): string {
  return createHash('sha256').update(content).digest('hex')
}

export function hasSameContentHash(existingContent: string | undefined, generatedContent: string): boolean {
  return existingContent !== undefined && hashContent(existingContent) === hashContent(generatedContent)
}
