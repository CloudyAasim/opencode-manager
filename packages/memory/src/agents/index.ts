import type { AgentRole, AgentDefinition } from './types'
import { codeAgent } from './code'
import { memoryAgent } from './memory'
import { architectAgent } from './architect'

export const agents: Record<AgentRole, AgentDefinition> = {
  code: codeAgent,
  memory: memoryAgent,
  architect: architectAgent,
}

export { type AgentRole, type AgentDefinition, type AgentConfig } from './types'
