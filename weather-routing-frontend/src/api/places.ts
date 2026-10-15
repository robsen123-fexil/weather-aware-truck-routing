import { apiRequest, apiRequestWithRetry } from './client'

export interface PlaceSuggestion {
  /** Provider identifier (ORS Pelias gid or OSM type/id) for the selected place. */
  id?: string | null
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
  /** Which real geocoding provider answered (openrouteservice | nominatim). */
  provider?: string | null
  /** True when the backend served a short-lived cached copy of a provider answer. */
  cached?: boolean
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
  // No wake-wait here (typing cancels each effect). A couple of short retries cover
  // a cold-starting API; real provider failures are surfaced to the caller as errors.
  return apiRequestWithRetry<PlaceSuggestResponse>(`/api/places/suggest/?${qs}`, {
    signal: options?.signal,
    timeoutMs: 15_000,
  }, { retries: 2, retryDelayMs: 700 })
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
