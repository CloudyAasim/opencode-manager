import { DEFAULTS } from '@opencode-manager/shared/config/defaults'
import { FetchError } from '@opencode-manager/shared/types/errors'
import type { ApiErrorResponse } from '@opencode-manager/shared'

export { FetchError }

interface FetchWrapperOptions extends RequestInit {
  timeout?: number
  params?: Record<string, string | number | boolean | undefined>
  retry?: number
}

function formatDetails(details: unknown): string | undefined {
  if (Array.isArray(details)) {
    return details
      .map((d) => {
        if (typeof d !== 'object' || d === null) return null
        const path = Array.isArray((d as Record<string, unknown>).path) 
          ? ((d as Record<string, unknown>).path as string[]) 
          : undefined
        const message = typeof (d as Record<string, unknown>).message === 'string'
          ? (d as Record<string, unknown>).message as string
          : undefined
        return path?.length ? `${path.join('.')}: ${message}` : message
      })
      .filter(Boolean)
      .join('; ')
  }
  if (typeof details === 'string') return details
  return undefined
}

async function handleResponse(response: Response): Promise<never> {
  const text = await response.text().catch(() => '')
  const data: ApiErrorResponse = (() => {
    if (!text) return { error: 'An error occurred' }
    try {
      return JSON.parse(text) as ApiErrorResponse
    } catch {
      return { error: text }
    }
  })()
  const errorData = data as ApiErrorResponse & { message?: string; data?: { message?: unknown } }
  const openCodeMessage = typeof errorData.data?.message === 'string'
    ? errorData.data.message
    : undefined
  const detail = data.detail || formatDetails(data.details)
  throw new FetchError(
    data.error || errorData.message || openCodeMessage || 'Request failed',
    response.status,
    data.code,
    detail,
    {
      details: data.details,
      validationIssues: data.validationIssues,
    }
  )
}

function buildUrl(url: string, params?: Record<string, string | number | boolean | undefined>): URL {
  const urlObj = new URL(url, window.location.origin)
  if (params) {
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined) {
        urlObj.searchParams.append(key, String(value))
      }
    })
  }
  return urlObj
}

const RETRYABLE_STATUS = new Set([502, 503, 504])

function isIdempotentMethod(method: string | undefined): boolean {
  const normalized = (method ?? 'GET').toUpperCase()
  return normalized === 'GET' || normalized === 'HEAD'
}

function delay(ms: number, signal: AbortSignal | null | undefined): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Aborted', 'AbortError'))
      return
    }
    const timer = setTimeout(resolve, ms)
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer)
        reject(new DOMException('Aborted', 'AbortError'))
      },
      { once: true },
    )
  })
}

async function fetchWithTimeout(
  url: string,
  options: FetchWrapperOptions = {}
): Promise<Response> {
  const { timeout = DEFAULTS.TIMEOUTS.HTTP_REQUEST_MS, params, retry, ...fetchOptions } = options
  const maxRetries = typeof retry === 'number'
    ? retry
    : isIdempotentMethod(fetchOptions.method) ? DEFAULTS.TIMEOUTS.HTTP_GET_RETRIES : 0
  const urlObj = buildUrl(url, params)
  const externalSignal = fetchOptions.signal
  let lastError: unknown

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    const controller = new AbortController()
    const timeoutId = timeout > 0 ? setTimeout(() => controller.abort(), timeout) : null
    const abortFromExternal = () => controller.abort()
    if (externalSignal) {
      if (externalSignal.aborted) controller.abort()
      else externalSignal.addEventListener('abort', abortFromExternal, { once: true })
    }

    let response: Response
    try {
      response = await fetch(urlObj.toString(), {
        credentials: 'include',
        ...fetchOptions,
        signal: controller.signal,
      })
    } catch (error) {
      if (timeoutId) clearTimeout(timeoutId)
      if (externalSignal) externalSignal.removeEventListener('abort', abortFromExternal)
      lastError = error

      const aborted = error instanceof Error && error.name === 'AbortError'
      const timedOut = aborted && !(externalSignal?.aborted ?? false)
      if (attempt < maxRetries && (timedOut || !aborted)) {
        await delay(500 * 2 ** attempt, externalSignal)
        continue
      }
      if (timedOut) {
        throw new FetchError('Request timeout', 408, 'TIMEOUT')
      }
      throw error
    }

    if (timeoutId) clearTimeout(timeoutId)
    if (externalSignal) externalSignal.removeEventListener('abort', abortFromExternal)

    if (!response.ok) {
      if (attempt < maxRetries && RETRYABLE_STATUS.has(response.status)) {
        await delay(500 * 2 ** attempt, externalSignal)
        continue
      }
      await handleResponse(response)
    }

    return response
  }

  throw lastError
}

async function fetchWrapper<T = unknown>(
  url: string,
  options: FetchWrapperOptions = {}
): Promise<T> {
  const response = await fetchWithTimeout(url, options)

  try {
    return await response.json()
  } catch {
    throw new FetchError('Invalid JSON response', response.status, 'INVALID_JSON')
  }
}

async function fetchWrapperVoid(
  url: string,
  options: FetchWrapperOptions = {}
): Promise<void> {
  await fetchWithTimeout(url, options)
}

async function fetchWrapperBlob(
  url: string,
  options: FetchWrapperOptions = {}
): Promise<Blob> {
  const response = await fetchWithTimeout(url, options)
  return response.blob()
}

export { fetchWrapper, fetchWrapperVoid, fetchWrapperBlob }
