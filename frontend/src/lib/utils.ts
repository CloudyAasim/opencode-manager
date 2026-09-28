import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"
import type { CSSProperties } from "react"

export { getRepoDisplayName } from '@opencode-manager/shared/utils'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function randomId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 11)}`
}

export const GPU_ACCELERATED_STYLE: CSSProperties = {
  transform: 'translateZ(0)',
  backfaceVisibility: 'hidden',
  WebkitBackfaceVisibility: 'hidden',
}

export const MODAL_TRANSITION_MS = 300

export function sanitizeForTTS(text: string): string {
  if (!text) return ''

  let sanitized = text

  sanitized = sanitized.replace(/```[\s\S]*?```/g, '')

  sanitized = sanitized.replace(/`([^`]+)`/g, '$1')

  sanitized = sanitized.replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1')

  sanitized = sanitized.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')

  sanitized = sanitized.replace(/\*\*([^*]+)\*\*/g, '$1')
  sanitized = sanitized.replace(/__([^_]+)__/g, '$1')

  sanitized = sanitized.replace(/\*([^*]+)\*/g, '$1')
  sanitized = sanitized.replace(/_([^_]+)_/g, '$1')

  sanitized = sanitized.replace(/~~([^~]+)~~/g, '$1')

  sanitized = sanitized.replace(/^#{1,6}\s+/gm, '')

  sanitized = sanitized.replace(/^\s*[-*+]\s+/gm, '')
  sanitized = sanitized.replace(/^\s*\d+\.\s+/gm, '')

  sanitized = sanitized.replace(/^>\s+/gm, '')

  sanitized = sanitized.replace(/^(\*\*\*|---|___)\s*$/gm, '')

  sanitized = sanitized.replace(/\[\^[^\]]+\]/g, '')

  sanitized = sanitized.replace(/\[\d+(,\d+)*\]/g, '')

  sanitized = sanitized.replace(/<[^>]*>/g, '')

  const lines = sanitized.split('\n')
  const processedLines: string[] = []

  for (const line of lines) {
    const trimmed = line.trim()
    
    if (/^[|\s\-_=]+$/.test(trimmed)) {
      continue
    }

    if (trimmed.includes('|')) {
      const cells = trimmed.split('|')
        .map(s => s.trim())
        .filter(s => s.length > 0)
        .join(' ')
      if (cells) processedLines.push(cells)
    } else if (trimmed) {
      processedLines.push(trimmed)
    }
  }

  sanitized = processedLines.join('\n')

  sanitized = sanitized.replace(/\n{3,}/g, '\n\n')
  sanitized = sanitized.replace(/[ \t]{2,}/g, ' ')
  sanitized = sanitized.trim()

  sanitized = sanitized.replace(/\s+([.,!?;:])/g, '$1')

  return sanitized
}
