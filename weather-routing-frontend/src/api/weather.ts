import { apiRequest } from './client'
import type { CorridorForecastResponse } from '../types/routing'

export interface ForecastPoint {
  lat: number
  lon: number
}

export interface ForecastQuery {
  points: ForecastPoint[]
  start?: string
  hours?: number
  step_hours?: number
}

/** GET single-point forecast (query params). */
export function getPointForecast(params: {
  lat: number
  lon: number
  start?: string
  hours?: number
  step_hours?: number
}): Promise<CorridorForecastResponse> {
  const qs = new URLSearchParams({
    lat: String(params.lat),
    lon: String(params.lon),
    hours: String(params.hours ?? 48),
    step_hours: String(params.step_hours ?? 3),
  })
  if (params.start) qs.set('start', params.start)
  return apiRequest<CorridorForecastResponse>(`/api/weather/forecast/?${qs}`)
}

/** POST corridor forecast with multiple points (preferred for heatmap). */
export function postCorridorForecast(
  query: ForecastQuery,
  options?: { signal?: AbortSignal },
): Promise<CorridorForecastResponse> {
  return apiRequest<CorridorForecastResponse>('/api/weather/forecast/', {
    method: 'POST',
    body: JSON.stringify({
      points: query.points,
      start: query.start,
      hours: query.hours ?? 48,
      step_hours: query.step_hours ?? 3,
    }),
    signal: options?.signal,
  })
}
