import { apiRequest } from './client'
import type {
  AnalyzedRoute,
  AnalyzeRoutesRequest,
  AnalyzeRoutesResponse,
  HealthResponse,
} from '../types/routing'

export function checkHealth(): Promise<HealthResponse> {
  return apiRequest<HealthResponse>('/api/health/')
}

export function analyzeRoutes(
  payload: AnalyzeRoutesRequest,
  options?: { signal?: AbortSignal },
): Promise<AnalyzeRoutesResponse> {
  return apiRequest<AnalyzeRoutesResponse>('/api/routes/analyze/', {
    method: 'POST',
    body: JSON.stringify(payload),
    signal: options?.signal,
  })
}

export function getRoute(routeId: string): Promise<AnalyzedRoute> {
  return apiRequest<AnalyzedRoute>(`/api/routes/${encodeURIComponent(routeId)}/`)
}
