import type { Database } from 'bun:sqlite'
import type { CreatePromptTemplateRequest, UpdatePromptTemplateRequest } from '@opencode-manager/shared/schemas'
import {
  listPromptTemplates,
  getPromptTemplateById,
  getPromptTemplateOwnerId,
  createPromptTemplate,
  updatePromptTemplate,
  deletePromptTemplate,
} from '../db/prompt-templates'
import { canAccessOwner, type Principal } from '../auth/ownership'

export class PromptTemplateServiceError extends Error {
  constructor(message: string, public statusCode: number = 500) {
    super(message)
    this.name = 'PromptTemplateServiceError'
  }
}

function assertEditable(ownerId: string | null | undefined, principal: Principal | null): void {
  if (ownerId === undefined) throw new PromptTemplateServiceError('Template not found', 404)
  if (principal?.role === 'admin') return
  // Built-in (shared) templates and other users' templates are read-only.
  if (ownerId === null || ownerId !== principal?.id) {
    throw new PromptTemplateServiceError('Forbidden', 403)
  }
}

export class PromptTemplateService {
  constructor(private db: Database) {}

  list(principal: Principal | null) {
    return listPromptTemplates(this.db, principal?.id ?? null, principal?.role === 'admin')
  }

  getById(id: number, principal: Principal | null) {
    const template = getPromptTemplateById(this.db, id)
    if (!template) throw new PromptTemplateServiceError('Template not found', 404)
    const owner = getPromptTemplateOwnerId(this.db, id)
    if (!canAccessOwner(owner, principal)) {
      throw new PromptTemplateServiceError('Forbidden', 403)
    }
    return template
  }

  create(data: CreatePromptTemplateRequest, principal: Principal | null) {
    return createPromptTemplate(this.db, data, principal?.id ?? null)
  }

  update(id: number, data: UpdatePromptTemplateRequest, principal: Principal | null) {
    assertEditable(getPromptTemplateOwnerId(this.db, id), principal)
    const template = updatePromptTemplate(this.db, id, data)
    if (!template) throw new PromptTemplateServiceError('Template not found', 404)
    return template
  }

  delete(id: number, principal: Principal | null) {
    assertEditable(getPromptTemplateOwnerId(this.db, id), principal)
    const deleted = deletePromptTemplate(this.db, id)
    if (!deleted) throw new PromptTemplateServiceError('Template not found', 404)
  }
}
