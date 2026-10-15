import { apiRequest, apiRequestWithRetry, ensureApiAwake } from './client'

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
): Promise<PlaceSuggestResponse> {
  const qs = new URLSearchParams({
    q: query,
    limit: String(limit),
  })
  try {
    await ensureApiAwake()
  } catch {
    /* suggest retry still handles cold start */
  }
  return apiRequestWithRetry<PlaceSuggestResponse>(`/api/places/suggest/?${qs}`, {
    timeoutMs: 25_000,
  }, { retries: 3, retryDelayMs: 1000 })
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
  return apiRequest<ReverseGeocodeResponse>(`/api/places/reverse/?${qs}`)
}
