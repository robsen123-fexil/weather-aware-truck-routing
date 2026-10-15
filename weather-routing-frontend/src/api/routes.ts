import { apiRequest, apiRequestWithRetry } from './client'
import type {
  AnalyzedRoute,
  AnalyzeRoutesRequest,
  AnalyzeRoutesResponse,
  HealthResponse,
} from '../types/routing'

/** Wake a cold Render instance before the heavy analyze call. */
export async function checkHealth(options?: { signal?: AbortSignal }): Promise<HealthResponse> {
  return apiRequestWithRetry<HealthResponse>('/api/health/', {
    signal: options?.signal,
    timeoutMs: 45_000,
  }, { retries: 2, retryDelayMs: 800 })
}

export async function analyzeRoutes(
  payload: AnalyzeRoutesRequest,
  options?: { signal?: AbortSignal },
): Promise<AnalyzeRoutesResponse> {
  // Warm the API (free-tier cold start) so the analyze POST is less likely to drop.
  try {
    await checkHealth({ signal: options?.signal })
  } catch {
    // Analyze retry loop below still covers a cold/offline API.
  }

  return apiRequestWithRetry<AnalyzeRoutesResponse>('/api/routes/analyze/', {
    method: 'POST',
    body: JSON.stringify(payload),
    signal: options?.signal,
    timeoutMs: 150_000,
  }, { retries: 2, retryDelayMs: 1500 })
}

export function getRoute(routeId: string): Promise<AnalyzedRoute> {
  return apiRequest<AnalyzedRoute>(`/api/routes/${encodeURIComponent(routeId)}/`)
}
