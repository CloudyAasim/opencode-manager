export abstract class ServiceError extends Error {
  abstract readonly statusCode: number
}

export class ValidationError extends ServiceError {
  readonly statusCode = 400
  constructor(message: string) {
    super(message)
    this.name = 'ValidationError'
  }
}

export class UnauthorizedError extends ServiceError {
  readonly statusCode = 401
  constructor(message = 'Unauthorized') {
    super(message)
    this.name = 'UnauthorizedError'
  }
}

export class ForbiddenError extends ServiceError {
  readonly statusCode = 403
  constructor(message = 'Forbidden') {
    super(message)
    this.name = 'ForbiddenError'
  }
}

export class NotFoundError extends ServiceError {
  readonly statusCode = 404
  constructor(message: string) {
    super(message)
    this.name = 'NotFoundError'
  }
}

export class ConflictError extends ServiceError {
  readonly statusCode = 409
  constructor(message: string) {
    super(message)
    this.name = 'ConflictError'
  }
}

export class UnprocessableError extends ServiceError {
  readonly statusCode = 422
  constructor(message: string) {
    super(message)
    this.name = 'UnprocessableError'
  }
}

export class UpstreamUnavailableError extends ServiceError {
  readonly statusCode = 502
  constructor(message: string) {
    super(message)
    this.name = 'UpstreamUnavailableError'
  }
}

export class RepositoryNotFoundError extends NotFoundError {
  constructor(identifier: string | number) {
    super(`Repository with id ${identifier} not found`)
    this.name = 'RepositoryNotFoundError'
  }
}

export function isServiceError(error: unknown): error is ServiceError {
  return error instanceof ServiceError
}

export function statusCodeFor(error: unknown): number {
  if (isServiceError(error)) return error.statusCode
  return 500
}

export function repoNotFoundResponse(c: { json: (body: { error: string }, status: number) => Response }) {
  return c.json({ error: 'Repo not found' }, 404)
}

export function serviceErrorToResponse(c: { json: (body: unknown, status: number) => Response }, error: ServiceError): Response {
  return c.json({ error: error.message }, error.statusCode)
}


export class SkillNotFoundError extends NotFoundError {
  constructor(name: string, scope: string) {
    super(`Skill "${name}" not found in ${scope} scope`)
    this.name = 'SkillNotFoundError'
  }
}

export class SkillAlreadyExistsError extends ConflictError {
  constructor(name: string, scope: string) {
    super(`Skill "${name}" already exists in ${scope} scope`)
    this.name = 'SkillAlreadyExistsError'
  }
}

export class RepositoryAlreadyExistsError extends ConflictError {
  constructor(name: string) {
    super(`A repository named '${name}' already exists in the workspace. Please remove it first or use a different source directory.`)
    this.name = 'RepositoryAlreadyExistsError'
  }
}

export class ServiceUnavailableError extends ServiceError {
  readonly statusCode = 503
  constructor(message: string) {
    super(message)
    this.name = 'ServiceUnavailableError'
  }
}
