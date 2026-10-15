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
}

export async function apiRequest<T>(
  path: string,
  options: ApiRequestOptions = {},
): Promise<T> {
  const url = `${BASE_URL}${path.startsWith('/') ? path : `/${path}`}`

  let response: Response
  try {
    response = await fetch(url, {
      ...options,
      headers: {
        Accept: 'application/json',
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...options.headers,
      },
    })
  } catch (err) {
    // Aborts (route change / HMR / new analyze) must not look like offline errors.
    if (
      (err instanceof DOMException && err.name === 'AbortError')
      || (err instanceof Error && err.name === 'AbortError')
      || options.signal?.aborted
    ) {
      throw err instanceof DOMException
        ? err
        : new DOMException('The operation was aborted.', 'AbortError')
    }
    throw new ApiError(
      'Network request failed',
      0,
      'network_error',
    )
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
