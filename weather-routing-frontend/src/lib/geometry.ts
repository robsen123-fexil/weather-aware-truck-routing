import type { AnalyzedRoute, RouteGeometry } from '../types/routing'

/**
 * Backend returns GeoJSON LineString coordinates as [lon, lat]
 * (OpenRouteService / OSRM). Validate and normalize for MapLibre.
 */
export function normalizeLineGeometry(
  geometry: RouteGeometry | undefined | null,
): GeoJSON.LineString | null {
  if (!geometry || geometry.type !== 'LineString') return null
  const coords = geometry.coordinates
  if (!Array.isArray(coords) || coords.length < 2) return null

  const normalized: [number, number][] = []
  for (const pair of coords) {
    if (!Array.isArray(pair) || pair.length < 2) continue
    const a = Number(pair[0])
    const b = Number(pair[1])
    if (!Number.isFinite(a) || !Number.isFinite(b)) continue
    // GeoJSON / ORS / OSRM: [longitude, latitude]
    // Guard against accidental [lat, lon] swaps when |lat| > 90.
    let lon = a
    let lat = b
    if (Math.abs(a) <= 90 && Math.abs(b) > 90 && Math.abs(b) <= 180) {
      // likely [lat, lon] — swap
      lat = a
      lon = b
    }
    if (Math.abs(lat) > 90 || Math.abs(lon) > 180) continue
    normalized.push([lon, lat])
  }

  if (normalized.length < 2) return null
  return { type: 'LineString', coordinates: normalized }
}

export function routesWithValidGeometry(routes: AnalyzedRoute[]): AnalyzedRoute[] {
  return routes.filter((r) => normalizeLineGeometry(r.geometry) != null)
}

export function extendBoundsFromLine(
  bounds: { extend: (coord: [number, number]) => void },
  line: GeoJSON.LineString,
) {
  for (const [lon, lat] of line.coordinates) {
    bounds.extend([lon, lat])
  }
}
