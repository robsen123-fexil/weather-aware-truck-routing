import { useCallback, useEffect, useRef, useState } from 'react'
import { ApiError } from '../api/client'
import { analyzeRoutes } from '../api/routes'
import { postCorridorForecast } from '../api/weather'
import { userFacingError } from '../lib/userMessages'
import type {
  AnalyzeRoutesRequest,
  AnalyzeRoutesResponse,
  CorridorForecastResponse,
} from '../types/routing'

function subsamplePoints<T extends { lat: number; lon: number }>(
  points: T[],
  maxPoints: number,
): T[] {
  if (points.length <= maxPoints) return points
  const result: T[] = []
  const step = (points.length - 1) / (maxPoints - 1)
  for (let i = 0; i < maxPoints; i += 1) {
    result.push(points[Math.round(i * step)]!)
  }
  return result
}

async function loadCorridorForecast(
  result: AnalyzeRoutesResponse,
  routeId: string | null,
  signal: AbortSignal,
): Promise<CorridorForecastResponse | null> {
  const route =
    result.routes.find((r) => r.id === routeId)
    ?? result.routes.find((r) => r.id === result.recommendation.recommended_route_id)
    ?? result.routes[0]

  const seed =
    result.heatmap_seed_points
    ?? route?.checkpoints.map((c) => ({
      lat: c.coordinates.lat,
      lon: c.coordinates.lon,
    }))
    ?? []

  if (seed.length === 0) return null

  const points = subsamplePoints(seed, 8)
  const attempt = () =>
    postCorridorForecast({
      points,
      start: result.request.departure,
      hours: 48,
      step_hours: 3,
    }, { signal })

  try {
    return await attempt()
  } catch (err) {
    if (signal.aborted) throw err
    // One retry — free-tier weather / cold starts can flake once.
    return attempt()
  }
}

export function useRouteAnalysis() {
  const [data, setData] = useState<AnalyzeRoutesResponse | null>(null)
  const [selectedRouteId, setSelectedRouteId] = useState<string | null>(null)
  const [forecast, setForecast] = useState<CorridorForecastResponse | null>(null)
  const [forecastHour, setForecastHour] = useState(0)
  const [loading, setLoading] = useState(false)
  const [forecastLoading, setForecastLoading] = useState(false)
  const [forecastError, setForecastError] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  /** Bumps on each successful analysis — forces map remount/fit for new trips. */
  const [analysisGeneration, setAnalysisGeneration] = useState(0)
  /** Bumps when the user picks a route from cards/table so the map can fit that route. */
  const [fitGeneration, setFitGeneration] = useState(0)

  const requestGenRef = useRef(0)
  const analyzeAbortRef = useRef<AbortController | null>(null)
  const forecastAbortRef = useRef<AbortController | null>(null)

  const selectedRoute =
    data?.routes.find((r) => r.id === selectedRouteId) ?? data?.routes[0] ?? null

  const cancelInFlight = useCallback(() => {
    analyzeAbortRef.current?.abort()
    forecastAbortRef.current?.abort()
    analyzeAbortRef.current = null
    forecastAbortRef.current = null
  }, [])

  const runAnalysis = useCallback(async (request: AnalyzeRoutesRequest) => {
    cancelInFlight()
    const gen = ++requestGenRef.current

    setLoading(true)
    setError(null)
    setForecastError(null)
    setData(null)
    setSelectedRouteId(null)
    setForecast(null)
    setForecastHour(0)

    const controller = new AbortController()
    analyzeAbortRef.current = controller

    try {
      const result = await analyzeRoutes(
        { ...request, include_heatmap_points: true },
        { signal: controller.signal },
      )
      if (gen !== requestGenRef.current) return

      const recommendedId = result.recommendation.recommended_route_id
      const initialId =
        recommendedId && result.routes.some((r) => r.id === recommendedId)
          ? recommendedId
          : result.routes[0]?.id ?? null

      setData(result)
      setSelectedRouteId(initialId)
      setAnalysisGeneration((g) => g + 1)
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return
      if (gen !== requestGenRef.current) return
      if (import.meta.env.DEV && err instanceof ApiError) {
        console.warn('Analyze failed', err.status, err.message, err.details)
      }
      setError(userFacingError(err))
      setData(null)
      setSelectedRouteId(null)
      setForecast(null)
      setForecastError(null)
    } finally {
      if (gen === requestGenRef.current) setLoading(false)
    }
  }, [cancelInFlight])

  const selectRoute = useCallback((id: string, options?: { fit?: boolean }) => {
    setSelectedRouteId(id)
    if (options?.fit) setFitGeneration((g) => g + 1)
  }, [])

  // Reload corridor heatmap when user inspects a different route on the same trip.
  useEffect(() => {
    if (!data || !selectedRouteId || loading) return

    forecastAbortRef.current?.abort()
    const gen = requestGenRef.current
    const controller = new AbortController()
    forecastAbortRef.current = controller

    let cancelled = false
    // Clear previous route's corridor samples immediately so a failed refetch
    // cannot leave stale heatmap dots from another path on the map.
    setForecast(null)
    setForecastError(null)
    setForecastLoading(true)

    loadCorridorForecast(data, selectedRouteId, controller.signal)
      .then((corridor) => {
        if (cancelled || gen !== requestGenRef.current) return
        if (corridor && corridor.frames.length > 0) {
          setForecast(corridor)
          setForecastError(null)
          setForecastHour((h) => {
            const offsets = corridor.frames.map((f) => f.hour_offset)
            return offsets.includes(h) ? h : (offsets[0] ?? 0)
          })
        } else {
          setForecast(null)
          setForecastError(
            'Corridor forecast is unavailable for this route right now.',
          )
        }
      })
      .catch((err) => {
        if (err instanceof DOMException && err.name === 'AbortError') return
        if (cancelled || gen !== requestGenRef.current) return
        if (import.meta.env.DEV) console.warn('Route forecast refresh failed', err)
        setForecast(null)
        setForecastError(
          'Could not load the corridor forecast timeline. Route cards still use ETA-matched checkpoint weather.',
        )
      })
      .finally(() => {
        if (!cancelled && gen === requestGenRef.current) setForecastLoading(false)
      })

    return () => {
      cancelled = true
      controller.abort()
    }
  }, [data, selectedRouteId, loading])

  return {
    data,
    selectedRoute,
    selectedRouteId,
    setSelectedRouteId,
    selectRoute,
    forecast,
    forecastHour,
    setForecastHour,
    loading,
    forecastLoading,
    forecastError,
    error,
    analysisGeneration,
    fitGeneration,
    runAnalysis,
  }
}
