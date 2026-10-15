import type { ApiErrorBody } from '../types/routing'

const BASE_URL = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(/\/$/, '')
  || 'http://127.0.0.1:8000'

export class ApiError extends Error {
  status: number
  code?: string
  details?: unknown

  constructor(message: string, status: number, code?: string, details?: unknown) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.details = details
  }
}

export function getApiBaseUrl(): string {
  return BASE_URL
}

export type ApiRequestOptions = RequestInit & {
  signal?: AbortSignal
  /** Per-attempt timeout in ms (default: none). */
  timeoutMs?: number
}

function isAbortError(err: unknown): boolean {
  return (
    (err instanceof DOMException && err.name === 'AbortError')
    || (err instanceof Error && err.name === 'AbortError')
  )
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms)
  })
}

export async function apiRequest<T>(
  path: string,
  options: ApiRequestOptions = {},
): Promise<T> {
  const url = `${BASE_URL}${path.startsWith('/') ? path : `/${path}`}`
  const { timeoutMs, signal: externalSignal, ...init } = options

  const controller = new AbortController()
  const onExternalAbort = () => controller.abort()
  if (externalSignal) {
    if (externalSignal.aborted) {
      throw new DOMException('The operation was aborted.', 'AbortError')
    }
    externalSignal.addEventListener('abort', onExternalAbort, { once: true })
  }

  let timeoutId: number | undefined
  if (timeoutMs != null && timeoutMs > 0) {
    timeoutId = window.setTimeout(() => {
      controller.abort()
    }, timeoutMs)
  }

  let response: Response
  try {
    response = await fetch(url, {
      ...init,
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        ...init.headers,
      },
    })
  } catch (err) {
    if (externalSignal?.aborted) {
      throw new DOMException('The operation was aborted.', 'AbortError')
    }
    if (isAbortError(err)) {
      // Our timer fired and the caller did not cancel — treat as timeout.
      if (timeoutMs != null && timeoutMs > 0 && !externalSignal?.aborted) {
        throw new ApiError(
          'The planning service took too long to respond. Please try again.',
          504,
          'timeout',
        )
      }
      throw err instanceof DOMException
        ? err
        : new DOMException('The operation was aborted.', 'AbortError')
    }
    throw new ApiError(
      'Network request failed',
      0,
      'network_error',
    )
  } finally {
    if (timeoutId != null) window.clearTimeout(timeoutId)
    externalSignal?.removeEventListener('abort', onExternalAbort)
  }

  const text = await response.text()
  let data: unknown = null
  if (text) {
    try {
      data = JSON.parse(text)
    } catch {
      if (import.meta.env.DEV) {
        console.warn('Non-JSON API response', text.slice(0, 200))
      }
      throw new ApiError(
        'Unexpected server response',
        response.status,
        'invalid_response',
      )
    }
  }

  if (!response.ok) {
    const body = data as ApiErrorBody
    const raw =
      body?.error?.message
      || (typeof data === 'object' && data && 'detail' in data
        ? String((data as { detail: unknown }).detail)
        : '')
    const code = body?.error?.code
    throw new ApiError(
      raw || `Request failed (${response.status})`,
      response.status,
      code,
      body?.error?.details,
    )
  }

  return data as T
}

function isRetryable(err: unknown): boolean {
  if (!(err instanceof ApiError)) return false
  if (err.code === 'network_error' || err.code === 'timeout') return true
  return err.status === 502 || err.status === 503 || err.status === 504 || err.status === 429
}

/**
 * Retry transient failures (cold starts, brief outages, rate limits).
 * User aborts are never retried.
 */
export async function apiRequestWithRetry<T>(
  path: string,
  options: ApiRequestOptions = {},
  config: { retries?: number; timeoutMs?: number; retryDelayMs?: number } = {},
): Promise<T> {
  const retries = config.retries ?? 2
  const timeoutMs = config.timeoutMs ?? options.timeoutMs
  const retryDelayMs = config.retryDelayMs ?? 1200
  let lastError: unknown

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    if (options.signal?.aborted) {
      throw new DOMException('The operation was aborted.', 'AbortError')
    }
    try {
      return await apiRequest<T>(path, { ...options, timeoutMs })
    } catch (err) {
      lastError = err
      if (isAbortError(err) || options.signal?.aborted) throw err
      if (!isRetryable(err) || attempt >= retries) throw err
      await sleep(retryDelayMs * (attempt + 1))
    }
  }

  throw lastError
}
