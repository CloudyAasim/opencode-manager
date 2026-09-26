import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { Database } from 'bun:sqlite'
import { migrate } from '../../src/db/migration-runner'
import { allMigrations } from '../../src/db/migrations'
import { PromptTemplateService, PromptTemplateServiceError } from '../../src/services/prompt-templates'

const USER = { id: 'u1', role: 'user' as const }
const OTHER = { id: 'u2', role: 'user' as const }
const ADMIN = { id: 'admin', role: 'admin' as const }

function createTemplateInput(overrides: Record<string, unknown> = {}) {
  return {
    title: 'Daily standup',
    category: 'standup',
    cadenceHint: 'daily',
    suggestedName: 'daily-standup',
    suggestedDescription: 'Summarize yesterday',
    description: 'A standup prompt',
    prompt: 'Summarize my work',
    ...overrides,
  }
}

describe('PromptTemplateService', () => {
  let db: Database
  let service: PromptTemplateService

  beforeEach(() => {
    db = new Database(':memory:')
    migrate(db, allMigrations)
    service = new PromptTemplateService(db)
  })

  afterEach(() => {
    db.close()
  })

  it('creates, lists, and gets a template', () => {
    const created = service.create(createTemplateInput(), USER)

    expect(service.list(USER).map(template => template.id)).toContain(created.id)
    expect(service.getById(created.id, USER)).toEqual(created)
  })

  it('throws a 404 service error when a template is missing', () => {
    expect(() => service.getById(999, USER)).toThrow(PromptTemplateServiceError)

    try {
      service.getById(999, USER)
    } catch (error) {
      expect(error).toBeInstanceOf(PromptTemplateServiceError)
      expect((error as PromptTemplateServiceError).statusCode).toBe(404)
      expect((error as Error).message).toBe('Template not found')
    }
  })

  it('updates an existing template', () => {
    const created = service.create(createTemplateInput(), USER)

    const updated = service.update(created.id, { title: 'Renamed' }, USER)

    expect(updated.title).toBe('Renamed')
    expect(service.getById(created.id, USER).title).toBe('Renamed')
  })

  it('throws a 404 service error when updating a missing template', () => {
    try {
      service.update(999, { title: 'Missing' }, USER)
      throw new Error('expected update to throw')
    } catch (error) {
      expect(error).toBeInstanceOf(PromptTemplateServiceError)
      expect((error as PromptTemplateServiceError).statusCode).toBe(404)
    }
  })

  it('deletes an existing template', () => {
    const created = service.create(createTemplateInput(), USER)

    service.delete(created.id, USER)

    expect(service.list(USER).map(template => template.id)).not.toContain(created.id)
  })

  it('throws a 404 service error when deleting a missing template', () => {
    try {
      service.delete(999, USER)
      throw new Error('expected delete to throw')
    } catch (error) {
      expect(error).toBeInstanceOf(PromptTemplateServiceError)
      expect((error as PromptTemplateServiceError).statusCode).toBe(404)
    }
  })

  it('isolates user templates while sharing the built-in library', () => {
    const own = service.create(createTemplateInput({ title: 'Mine' }), USER)
    const other = service.create(createTemplateInput({ title: 'Theirs' }), OTHER)

    const userList = service.list(USER).map(template => template.id)
    expect(userList).toContain(own.id)
    expect(userList).not.toContain(other.id)

    expect(service.list(ADMIN).map(template => template.id)).toEqual(
      expect.arrayContaining([own.id, other.id]),
    )
  })

  it('prevents reading or mutating another user template', () => {
    const other = service.create(createTemplateInput({ title: 'Theirs' }), OTHER)

    expect(() => service.getById(other.id, USER)).toThrowError(
      expect.objectContaining({ statusCode: 403 }),
    )
    expect(() => service.update(other.id, { title: 'Hijacked' }, USER)).toThrowError(
      expect.objectContaining({ statusCode: 403 }),
    )
    expect(() => service.delete(other.id, USER)).toThrowError(
      expect.objectContaining({ statusCode: 403 }),
    )
  })
})
