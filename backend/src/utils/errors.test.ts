import { describe, it, expect } from 'vitest'
import {
  ValidationError,
  NotFoundError,
  ConflictError,
  RepositoryNotFoundError,
  ForbiddenError,
  UnauthorizedError,
  UnprocessableError,
  UpstreamUnavailableError,
  isServiceError,
  statusCodeFor,
  serviceErrorToResponse,
  repoNotFoundResponse,
} from './errors'

describe('ServiceError hierarchy', () => {
  it('exposes correct status codes', () => {
    expect(new ValidationError('x').statusCode).toBe(400)
    expect(new UnauthorizedError().statusCode).toBe(401)
    expect(new ForbiddenError().statusCode).toBe(403)
    expect(new NotFoundError('x').statusCode).toBe(404)
    expect(new ConflictError('x').statusCode).toBe(409)
    expect(new UnprocessableError('x').statusCode).toBe(422)
    expect(new UpstreamUnavailableError('x').statusCode).toBe(502)
  })

  it('RepositoryNotFoundError carries a useful message and 404 status', () => {
    const err = new RepositoryNotFoundError(42)
    expect(err).toBeInstanceOf(NotFoundError)
    expect(err.statusCode).toBe(404)
    expect(err.message).toBe('Repository with id 42 not found')
  })

  it('isServiceError narrows correctly', () => {
    const known: unknown = new ValidationError('x')
    const unknown: unknown = new Error('x')
    expect(isServiceError(known)).toBe(true)
    expect(isServiceError(unknown)).toBe(false)
    expect(isServiceError(null)).toBe(false)
    expect(isServiceError('boom')).toBe(false)
  })

  it('statusCodeFor falls back to 500 for plain errors', () => {
    expect(statusCodeFor(new ValidationError('x'))).toBe(400)
    expect(statusCodeFor(new Error('x'))).toBe(500)
    expect(statusCodeFor(null)).toBe(500)
  })

  it('serviceErrorToResponse uses the error status', () => {
    const c = { json: (body: unknown, status: number) => ({ body, status }) }
    const err = new ValidationError('bad input')
    const res = serviceErrorToResponse(
      c as unknown as Parameters<typeof serviceErrorToResponse>[0],
      err,
    ) as unknown as unknown as { body: { error: string }; status: number }
    expect(res.status).toBe(400)
    expect(res.body.error).toBe('bad input')
  })

  it('repoNotFoundResponse returns the standard 404 body', () => {
    const c = { json: (body: unknown, status: number) => ({ body, status }) }
    const res = repoNotFoundResponse(
      c as unknown as Parameters<typeof repoNotFoundResponse>[0],
    ) as unknown as unknown as { body: { error: string }; status: number }
    expect(res.status).toBe(404)
    expect(res.body.error).toBe('Repo not found')
  })
})
