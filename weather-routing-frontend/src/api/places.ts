import { apiRequest, apiRequestWithRetry } from './client'

export interface PlaceSuggestion {
  label: string
  lat: number
  lon: number
  type?: string
  country?: string | null
  state?: string | null
  city?: string | null
  source?: string
}

export interface PlaceSuggestResponse {
  query: string
  suggestions: PlaceSuggestion[]
}

export async function suggestPlaces(
  query: string,
  limit = 6,
  options?: { signal?: AbortSignal },
): Promise<PlaceSuggestResponse> {
  const qs = new URLSearchParams({
    q: query,
    limit: String(limit),
  })
  // Do NOT await ensureApiAwake here — typing cancels each effect, so a long
  // wake wait makes search appear broken. Retries handle cold starts.
  return apiRequestWithRetry<PlaceSuggestResponse>(`/api/places/suggest/?${qs}`, {
    signal: options?.signal,
    timeoutMs: 20_000,
  }, { retries: 4, retryDelayMs: 900 })
}

export interface ReverseGeocodeResponse {
  label: string
  full_label?: string
  lat: number
  lon: number
  country?: string | null
  state?: string | null
  city?: string | null
  road?: string | null
  source?: string
}

export async function reverseGeocode(
  lat: number,
  lon: number,
): Promise<ReverseGeocodeResponse> {
  const qs = new URLSearchParams({
    lat: String(lat),
    lon: String(lon),
  })
  return apiRequest<ReverseGeocodeResponse>(`/api/places/reverse/?${qs}`, {
    timeoutMs: 20_000,
  })
}
