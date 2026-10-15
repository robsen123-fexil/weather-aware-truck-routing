import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import * as maplibregl from 'maplibre-gl'
import type {
  GeoJSONSource,
  LngLatBoundsLike,
  Map as MaplibreMap,
  MapLayerMouseEvent,
} from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
// MapLibre GL JS v6 ships as ES modules only and loads its GeoJSON/vector-tile
// processing in a Web Worker. Under bundlers (Vite, webpack, etc.) the worker's
// own URL can't be reliably auto-detected from `import.meta.url`, so it must be
// registered explicitly — otherwise the worker silently fails to start. The
// failure mode is deceptive: the map still renders (raster basemap tiles are
// decoded on the main thread), but EVERY worker-dependent layer — our GeoJSON
// route lines and checkpoint circles — never renders, with no console error,
// no GL error, and a perfectly valid style/data model. `?worker&url` (not a
// plain `?url`) is required so Vite emits a self-contained worker chunk that
// includes the worker's shared sibling module.
import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'
import type {
  AnalyzedRoute,
  CorridorForecastResponse,
  GeocodedPlace,
} from '../types/routing'
import { riskColor, ROUTE_LINE_COLORS } from '../lib/riskColors'
import { extendBoundsFromLine, normalizeLineGeometry } from '../lib/geometry'
import { checkpointPopupHtml } from './CheckpointPopup'
import { WeatherHeatmap } from './WeatherHeatmap'

maplibregl.setWorkerUrl(maplibreWorkerUrl)

interface RouteMapProps {
  routes: AnalyzedRoute[]
  selectedRouteId: string | null
  recommendedRouteId?: string | null
  origin?: GeocodedPlace
  destination?: GeocodedPlace
  forecast: CorridorForecastResponse | null
  forecastHour: number
  heatmapOverlay: 'risk' | 'wind' | 'rain' | 'snow'
  loading?: boolean
  /** Incremented by the parent when a card/table selection should fit the map. */
  fitGeneration?: number
  onSelectRoute: (id: string) => void
  onSelectRecommended?: () => void
}

const CHECKPOINT_SOURCE = 'checkpoints'
const CHECKPOINT_LAYER = 'checkpoints-circles'
const CHECKPOINT_HALO = 'checkpoints-halo'
const MAX_ROUTES = 6

function routeLineId(i: number) {
  return `route-line-${i}`
}
function routeHitId(i: number) {
  return `route-hit-${i}`
}
function routeCasingId(i: number) {
  return `route-casing-${i}`
}
function routeSrcId(i: number) {
  return `route-src-${i}`
}

export function RouteMap({
  routes,
  selectedRouteId,
  recommendedRouteId,
  origin,
  destination,
  forecast,
  forecastHour,
  heatmapOverlay,
  loading = false,
  fitGeneration = 0,
  onSelectRoute,
  onSelectRecommended,
}: RouteMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<MaplibreMap | null>(null)
  const markersRef = useRef<maplibregl.Marker[]>([])
  const popupRef = useRef<maplibregl.Popup | null>(null)
  const hoverPopupRef = useRef<maplibregl.Popup | null>(null)
  const onSelectRef = useRef(onSelectRoute)
  const routesRef = useRef(routes)
  const lastFitGenRef = useRef(0)
  const [mapReady, setMapReady] = useState(false)
  const [showAlternatives, setShowAlternatives] = useState(true)
  const [showCheckpoints, setShowCheckpoints] = useState(true)
  const [geometryError, setGeometryError] = useState<string | null>(null)
  const [heatmapEpoch, setHeatmapEpoch] = useState(0)
  const [legendOpen, setLegendOpen] = useState(false)

  onSelectRef.current = onSelectRoute
  routesRef.current = routes

  const drawableRoutes = useMemo(
    () =>
      routes.filter((r) => normalizeLineGeometry(r.geometry) != null),
    [routes],
  )

  const skippedGeometryCount = routes.length - drawableRoutes.length

  const fitToRoute = useCallback((routeId?: string | null) => {
    const map = mapRef.current
    if (!map) return
    const target =
      (routeId && drawableRoutes.find((r) => r.id === routeId))
      || drawableRoutes.find((r) => r.id === selectedRouteId)
      || drawableRoutes[0]
    if (!target) return

    const line = normalizeLineGeometry(target.geometry)
    if (!line) return

    const bounds = new maplibregl.LngLatBounds()
    extendBoundsFromLine(bounds, line)
    if (origin) bounds.extend([origin.lon, origin.lat])
    if (destination) bounds.extend([destination.lon, destination.lat])
    target.checkpoints.forEach((cp) => {
      bounds.extend([cp.coordinates.lon, cp.coordinates.lat])
    })

    if (!bounds.isEmpty()) {
      map.fitBounds(bounds as LngLatBoundsLike, {
        padding: { top: 64, bottom: 72, left: 56, right: 56 },
        maxZoom: 12,
        duration: 650,
      })
    }
  }, [drawableRoutes, selectedRouteId, origin, destination])

  const fitAll = useCallback(() => {
    const map = mapRef.current
    if (!map || drawableRoutes.length === 0) return
    const bounds = new maplibregl.LngLatBounds()
    drawableRoutes.forEach((route) => {
      const line = normalizeLineGeometry(route.geometry)
      if (line) extendBoundsFromLine(bounds, line)
    })
    if (origin) bounds.extend([origin.lon, origin.lat])
    if (destination) bounds.extend([destination.lon, destination.lat])
    if (!bounds.isEmpty()) {
      map.fitBounds(bounds as LngLatBoundsLike, {
        padding: 64,
        maxZoom: 11,
        duration: 650,
      })
    }
  }, [drawableRoutes, origin, destination])

  // Init map once
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: {
        version: 8,
        sources: {
          osm: {
            type: 'raster',
            tiles: [
              'https://a.tile.openstreetmap.org/{z}/{x}/{y}.png',
              'https://b.tile.openstreetmap.org/{z}/{x}/{y}.png',
              'https://c.tile.openstreetmap.org/{z}/{x}/{y}.png',
            ],
            tileSize: 256,
            attribution: '© OpenStreetMap contributors',
          },
        },
        layers: [{ id: 'osm', type: 'raster', source: 'osm' }],
      },
      center: [0, 20],
      zoom: 1.5,
    })

    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right')
    map.addControl(new maplibregl.ScaleControl({ maxWidth: 120 }), 'bottom-right')

    const onCheckpointClick = (e: MapLayerMouseEvent) => {
      e.originalEvent.stopPropagation()
      const feature = e.features?.[0]
      if (!feature || !e.lngLat) return
      const raw = feature.properties?.payload
      if (!raw || typeof raw !== 'string') return
      try {
        const cp = JSON.parse(raw)
        popupRef.current?.remove()
        hoverPopupRef.current?.remove()
        popupRef.current = new maplibregl.Popup({
          maxWidth: '320px',
          closeButton: true,
          offset: 12,
        })
          .setLngLat(e.lngLat)
          .setHTML(checkpointPopupHtml(cp))
          .addTo(map)
      } catch {
        /* ignore */
      }
    }

    const onRouteClick = (e: MapLayerMouseEvent) => {
      const id = e.features?.[0]?.properties?.routeId
      if (typeof id === 'string') onSelectRef.current(id)
    }

    const onRouteEnter = (e: MapLayerMouseEvent) => {
      map.getCanvas().style.cursor = 'pointer'
      const props = e.features?.[0]?.properties
      if (!props || !e.lngLat) return
      const rank = props.rank ?? '?'
      const label = props.recommended === true || props.recommended === 'true'
        ? `Route ${rank} (Recommended)`
        : `Route ${rank}`
      hoverPopupRef.current?.remove()
      hoverPopupRef.current = new maplibregl.Popup({
        closeButton: false,
        closeOnClick: false,
        offset: 10,
        className: 'route-hover-popup',
      })
        .setLngLat(e.lngLat)
        .setHTML(`<div style="font:600 12px IBM Plex Sans,sans-serif;padding:2px 4px">${label}</div>`)
        .addTo(map)
    }

    const onRouteLeave = () => {
      map.getCanvas().style.cursor = ''
      hoverPopupRef.current?.remove()
      hoverPopupRef.current = null
    }

    const onRouteMove = (e: MapLayerMouseEvent) => {
      if (hoverPopupRef.current && e.lngLat) {
        hoverPopupRef.current.setLngLat(e.lngLat)
      }
    }

    map.on('load', () => {
      setMapReady(true)
      map.on('click', CHECKPOINT_LAYER, onCheckpointClick)
      for (let i = 0; i < MAX_ROUTES; i += 1) {
        map.on('click', routeHitId(i), onRouteClick)
        map.on('mouseenter', routeHitId(i), onRouteEnter)
        map.on('mouseleave', routeHitId(i), onRouteLeave)
        map.on('mousemove', routeHitId(i), onRouteMove)
      }
      map.on('mouseenter', CHECKPOINT_LAYER, () => {
        map.getCanvas().style.cursor = 'pointer'
      })
      map.on('mouseleave', CHECKPOINT_LAYER, () => {
        map.getCanvas().style.cursor = ''
      })
    })

    mapRef.current = map

    return () => {
      markersRef.current.forEach((m) => m.remove())
      markersRef.current = []
      popupRef.current?.remove()
      hoverPopupRef.current?.remove()
      map.remove()
      mapRef.current = null
      setMapReady(false)
    }
  }, [])

  // Draw / redraw routes when analysis data changes
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady) return

    // Clear previous layers/sources
    for (let i = 0; i < MAX_ROUTES; i += 1) {
      for (const id of [routeHitId(i), routeLineId(i), routeCasingId(i)]) {
        if (map.getLayer(id)) map.removeLayer(id)
      }
      if (map.getSource(routeSrcId(i))) map.removeSource(routeSrcId(i))
    }
    if (map.getLayer(CHECKPOINT_LAYER)) map.removeLayer(CHECKPOINT_LAYER)
    if (map.getLayer(CHECKPOINT_HALO)) map.removeLayer(CHECKPOINT_HALO)
    if (map.getSource(CHECKPOINT_SOURCE)) map.removeSource(CHECKPOINT_SOURCE)

    markersRef.current.forEach((m) => m.remove())
    markersRef.current = []
    popupRef.current?.remove()

    if (routes.length === 0) {
      setGeometryError(null)
      return
    }

    if (drawableRoutes.length === 0) {
      setGeometryError('Route geometry is missing or invalid — cannot draw road paths on the map.')
      return
    }
    if (skippedGeometryCount > 0) {
      setGeometryError(
        `${skippedGeometryCount} alternative route${skippedGeometryCount === 1 ? '' : 's'} could not be drawn (invalid or missing road geometry). Showing ${drawableRoutes.length} drawable route${drawableRoutes.length === 1 ? '' : 's'}.`,
      )
    } else {
      setGeometryError(null)
    }

    const bounds = new maplibregl.LngLatBounds()

    // Draw alternatives first (under), recommended/selected later for z-order via layer add order
    const ordered = [...drawableRoutes].sort((a, b) => {
      const aSel = a.id === selectedRouteId ? 1 : 0
      const bSel = b.id === selectedRouteId ? 1 : 0
      const aRec = a.id === recommendedRouteId ? 1 : 0
      const bRec = b.id === recommendedRouteId ? 1 : 0
      return aSel - bSel || aRec - bRec
    })

    ordered.forEach((route, drawIndex) => {
      const originalIndex = routes.findIndex((r) => r.id === route.id)
      const index = originalIndex >= 0 ? originalIndex : drawIndex
      const line = normalizeLineGeometry(route.geometry)!
      const isSelected = route.id === selectedRouteId
      const isRecommended = route.id === recommendedRouteId
      const isAlt = !isRecommended
      // Selected path is always sky-blue so the chosen route is obvious even when
      // it is not the recommended (green) alternative.
      const color = isSelected
        ? '#0284c7'
        : isRecommended
          ? '#059669'
          : ROUTE_LINE_COLORS[index % ROUTE_LINE_COLORS.length]!

      const visible = showAlternatives || isSelected || isRecommended

      map.addSource(routeSrcId(index), {
        type: 'geojson',
        data: {
          type: 'Feature',
          properties: {
            routeId: route.id,
            rank: route.rank ?? index + 1,
            recommended: isRecommended,
          },
          geometry: line,
        },
      })

      // Wide casing for recommended / selected
      map.addLayer({
        id: routeCasingId(index),
        type: 'line',
        source: routeSrcId(index),
        layout: {
          'line-join': 'round',
          'line-cap': 'round',
          visibility: visible ? 'visible' : 'none',
        },
        paint: {
          'line-color': '#ffffff',
          'line-width': isSelected || isRecommended ? 10 : 6,
          'line-opacity': isSelected || isRecommended ? 0.9 : 0.35,
        },
      })

      map.addLayer({
        id: routeLineId(index),
        type: 'line',
        source: routeSrcId(index),
        layout: {
          'line-join': 'round',
          'line-cap': 'round',
          visibility: visible ? 'visible' : 'none',
        },
        paint: {
          'line-color': color,
          'line-width': isSelected ? 7 : isRecommended ? 5.5 : 3,
          'line-opacity': isSelected ? 1 : isRecommended ? 0.92 : 0.38,
          'line-dasharray': isAlt && !isSelected ? [1.2, 1.6] : [1, 0],
        },
      })

      // Invisible wide hit area for easier clicks
      map.addLayer({
        id: routeHitId(index),
        type: 'line',
        source: routeSrcId(index),
        layout: {
          'line-join': 'round',
          'line-cap': 'round',
          visibility: visible ? 'visible' : 'none',
        },
        paint: {
          'line-color': color,
          'line-width': 18,
          'line-opacity': 0,
        },
      })

      extendBoundsFromLine(bounds, line)
    })

    // Checkpoints for selected route
    const selected = drawableRoutes.find((r) => r.id === selectedRouteId) ?? drawableRoutes[0]
    if (selected && showCheckpoints) {
      map.addSource(CHECKPOINT_SOURCE, {
        type: 'geojson',
        data: {
          type: 'FeatureCollection',
          features: selected.checkpoints.map((cp) => ({
            type: 'Feature',
            properties: {
              index: cp.index,
              color: riskColor(
                cp.risk?.overall_risk
                ?? (cp.weather?.available ? 'Low' : 'Unavailable'),
              ),
              risk:
                cp.risk?.overall_risk
                ?? (cp.weather?.available ? 'Low' : 'Unavailable'),
              payload: JSON.stringify(cp),
            },
            geometry: {
              type: 'Point',
              coordinates: [cp.coordinates.lon, cp.coordinates.lat],
            },
          })),
        },
      })

      map.addLayer({
        id: CHECKPOINT_HALO,
        type: 'circle',
        source: CHECKPOINT_SOURCE,
        paint: {
          'circle-radius': [
            'case',
            ['==', ['get', 'risk'], 'No Travel'], 14,
            ['==', ['get', 'risk'], 'Severe'], 12,
            ['==', ['get', 'risk'], 'Unavailable'], 11,
            10,
          ],
          'circle-color': ['get', 'color'],
          'circle-opacity': 0.25,
        },
      })

      map.addLayer({
        id: CHECKPOINT_LAYER,
        type: 'circle',
        source: CHECKPOINT_SOURCE,
        paint: {
          'circle-radius': [
            'case',
            ['==', ['get', 'risk'], 'No Travel'], 9,
            ['==', ['get', 'risk'], 'Unavailable'], 7,
            7,
          ],
          'circle-color': ['get', 'color'],
          'circle-stroke-width': [
            'case',
            ['==', ['get', 'risk'], 'No Travel'], 3,
            ['==', ['get', 'risk'], 'Unavailable'], 2.5,
            2,
          ],
          'circle-stroke-color': [
            'case',
            ['==', ['get', 'risk'], 'No Travel'], '#450a0a',
            ['==', ['get', 'risk'], 'Unavailable'], '#334155',
            '#ffffff',
          ],
        },
      })

      selected.checkpoints.forEach((cp) => {
        bounds.extend([cp.coordinates.lon, cp.coordinates.lat])
      })
    }

    const addEndpoint = (
      place: GeocodedPlace | undefined,
      kind: 'start' | 'end',
    ) => {
      if (!place || !Number.isFinite(place.lat) || !Number.isFinite(place.lon)) return
      const el = document.createElement('div')
      el.className = kind === 'start' ? 'map-endpoint-marker map-endpoint-start' : 'map-endpoint-marker map-endpoint-end'
      el.innerHTML = `<span>${kind === 'start' ? 'A' : 'B'}</span><em>${kind === 'start' ? 'Start' : 'End'}</em>`
      const short =
        place.label.length > 56 ? `${place.label.slice(0, 55)}…` : place.label
      el.title = `${kind === 'start' ? 'Origin' : 'Destination'}: ${short}`

      const marker = new maplibregl.Marker({ element: el, anchor: 'bottom' })
        .setLngLat([place.lon, place.lat])
        .setPopup(
          new maplibregl.Popup({ offset: 20 }).setHTML(
            `<strong>${kind === 'start' ? 'Origin' : 'Destination'}</strong><br/>`
            + `<span style="font-size:12px">${short}</span>`,
          ),
        )
        .addTo(map)
      markersRef.current.push(marker)
      bounds.extend([place.lon, place.lat])
    }

    addEndpoint(origin, 'start')
    addEndpoint(destination, 'end')

    if (!bounds.isEmpty()) {
      map.fitBounds(bounds as LngLatBoundsLike, {
        padding: { top: 64, bottom: 72, left: 56, right: 56 },
        maxZoom: 12,
        duration: 700,
      })
    }
    setHeatmapEpoch((e) => e + 1)
  // Intentionally omit selectedRouteId — selection styling handled separately to avoid full redraw flicker
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapReady, routes, origin, destination, recommendedRouteId, showAlternatives, showCheckpoints, drawableRoutes, skippedGeometryCount])

  // Fit map when parent requests it (e.g. "View on map" from a route card).
  useEffect(() => {
    if (!mapReady || fitGeneration <= 0 || fitGeneration === lastFitGenRef.current) return
    lastFitGenRef.current = fitGeneration
    window.setTimeout(() => fitToRoute(selectedRouteId), 40)
  }, [fitGeneration, mapReady, selectedRouteId, fitToRoute])

  // Update highlight + checkpoints when selection changes
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady) return

    routes.forEach((route, index) => {
      const lineId = routeLineId(index)
      const casingId = routeCasingId(index)
      const hitId = routeHitId(index)
      if (!map.getLayer(lineId)) return

      const isSelected = route.id === selectedRouteId
      const isRecommended = route.id === recommendedRouteId
      const isAlt = !isRecommended
      const visible = showAlternatives || isSelected || isRecommended
      const vis = visible ? 'visible' : 'none'
      const color = isSelected
        ? '#0284c7'
        : isRecommended
          ? '#059669'
          : ROUTE_LINE_COLORS[index % ROUTE_LINE_COLORS.length]!

      map.setLayoutProperty(lineId, 'visibility', vis)
      map.setLayoutProperty(casingId, 'visibility', vis)
      map.setLayoutProperty(hitId, 'visibility', vis)

      map.setPaintProperty(lineId, 'line-color', color)
      map.setPaintProperty(lineId, 'line-width', isSelected ? 7 : isRecommended ? 5.5 : 3)
      map.setPaintProperty(lineId, 'line-opacity', isSelected ? 1 : isRecommended ? 0.92 : 0.38)
      map.setPaintProperty(lineId, 'line-dasharray', isAlt && !isSelected ? [1.2, 1.6] : [1, 0])
      map.setPaintProperty(casingId, 'line-width', isSelected || isRecommended ? 10 : 6)
      map.setPaintProperty(casingId, 'line-opacity', isSelected || isRecommended ? 0.9 : 0.35)

      // Raise selected route layers to top (under heatmap/checkpoints)
      if (isSelected) {
        try {
          map.moveLayer(casingId)
          map.moveLayer(lineId)
          map.moveLayer(hitId)
          if (map.getLayer(CHECKPOINT_HALO)) map.moveLayer(CHECKPOINT_HALO)
          if (map.getLayer(CHECKPOINT_LAYER)) map.moveLayer(CHECKPOINT_LAYER)
        } catch {
          /* layer may not exist yet */
        }
      }
    })

    const selected = drawableRoutes.find((r) => r.id === selectedRouteId) ?? drawableRoutes[0]
    const source = map.getSource(CHECKPOINT_SOURCE) as GeoJSONSource | undefined

    if (!showCheckpoints) {
      if (map.getLayer(CHECKPOINT_LAYER)) map.setLayoutProperty(CHECKPOINT_LAYER, 'visibility', 'none')
      if (map.getLayer(CHECKPOINT_HALO)) map.setLayoutProperty(CHECKPOINT_HALO, 'visibility', 'none')
      return
    }

    if (source && selected) {
      source.setData({
        type: 'FeatureCollection',
        features: selected.checkpoints.map((cp) => ({
          type: 'Feature',
          properties: {
            index: cp.index,
            color: riskColor(
              cp.risk?.overall_risk
              ?? (cp.weather?.available ? 'Low' : 'Unavailable'),
            ),
            risk:
              cp.risk?.overall_risk
              ?? (cp.weather?.available ? 'Low' : 'Unavailable'),
            payload: JSON.stringify(cp),
          },
          geometry: {
            type: 'Point',
            coordinates: [cp.coordinates.lon, cp.coordinates.lat],
          },
        })),
      })
      if (map.getLayer(CHECKPOINT_LAYER)) map.setLayoutProperty(CHECKPOINT_LAYER, 'visibility', 'visible')
      if (map.getLayer(CHECKPOINT_HALO)) map.setLayoutProperty(CHECKPOINT_HALO, 'visibility', 'visible')
      setHeatmapEpoch((e) => e + 1)
    } else if (selected && showCheckpoints && !source) {
      // Source missing (first paint race) — no-op; redraw effect will create it
    }
  }, [
    mapReady,
    routes,
    selectedRouteId,
    recommendedRouteId,
    showAlternatives,
    showCheckpoints,
    drawableRoutes,
  ])

  const hasRoutes = routes.length > 0
  const empty = !loading && !hasRoutes

  return (
    <div className="relative h-full min-h-[480px] w-full overflow-hidden rounded-xl border border-slate-200 bg-slate-100 dark:border-slate-700 dark:bg-slate-900">
      <div ref={containerRef} className="h-full w-full" />

      <WeatherHeatmap
        map={mapReady ? mapRef.current : null}
        forecast={forecast}
        hour={forecastHour}
        overlay={heatmapOverlay}
        layerEpoch={heatmapEpoch}
      />

      {/* Map controls */}
      {hasRoutes && (
        <div className="pointer-events-none absolute top-3 left-3 z-10 flex max-w-[220px] flex-col gap-1.5">
          <div className="pointer-events-auto rounded-lg border border-slate-200 bg-white/95 p-1.5 shadow-sm dark:border-slate-600 dark:bg-slate-900/95">
            <div className="grid grid-cols-2 gap-1">
              <MapBtn onClick={() => fitToRoute(selectedRouteId)} title="Fit selected route">
                Fit route
              </MapBtn>
              <MapBtn onClick={fitAll} title="Show all routes">
                Fit all
              </MapBtn>
              <MapBtn
                onClick={() => {
                  if (recommendedRouteId) {
                    onSelectRecommended?.()
                    onSelectRoute(recommendedRouteId)
                  }
                }}
                title="Select recommended route"
                disabled={!recommendedRouteId}
              >
                Recommended
              </MapBtn>
              <MapBtn
                onClick={() => fitToRoute(selectedRouteId)}
                title="Center on selected"
              >
                Center
              </MapBtn>
            </div>
            <div className="mt-1 flex gap-1 border-t border-slate-100 pt-1 dark:border-slate-700">
              <MapBtn
                active={showAlternatives}
                onClick={() => setShowAlternatives((v) => !v)}
                title="Toggle alternative routes"
              >
                Alts {showAlternatives ? 'on' : 'off'}
              </MapBtn>
              <MapBtn
                active={showCheckpoints}
                onClick={() => setShowCheckpoints((v) => !v)}
                title="Toggle checkpoints"
              >
                Checks {showCheckpoints ? 'on' : 'off'}
              </MapBtn>
            </div>
          </div>
        </div>
      )}

      {/* Legend — collapsed to a small toggle by default so it never covers the map on small screens */}
      <div className="pointer-events-none absolute bottom-3 left-3 z-10 max-w-[280px]">
        {legendOpen ? (
          <div className="pointer-events-auto max-h-[min(60vh,360px)] overflow-y-auto rounded-lg border border-slate-200 bg-white/95 px-3 py-2 text-xs shadow-sm dark:border-slate-600 dark:bg-slate-900/95 dark:text-slate-200">
            <div className="mb-1.5 flex items-center justify-between gap-2">
              <p className="font-semibold text-slate-700 dark:text-slate-100">Map legend</p>
              <button
                type="button"
                onClick={() => setLegendOpen(false)}
                className="rounded px-1.5 py-0.5 text-[11px] font-medium text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
                aria-label="Close legend"
              >
                Close ✕
              </button>
            </div>
            <div className="mb-2 space-y-1 text-slate-600 dark:text-slate-300">
              <LegendLine color="#0284c7" label="Selected route (viewing)" solid />
              <LegendLine color="#059669" label="Recommended route" solid />
              <LegendLine color="#7c3aed" label="Other alternatives" dashed />
              <div className="flex items-center gap-2">
                <span className="inline-flex h-5 min-w-[1.25rem] items-center justify-center rounded bg-slate-900 px-1 text-[9px] font-bold text-white dark:bg-slate-100 dark:text-slate-900">A</span>
                Origin (start)
              </div>
              <div className="flex items-center gap-2">
                <span className="inline-flex h-5 min-w-[1.25rem] items-center justify-center rounded bg-sky-700 px-1 text-[9px] font-bold text-white">B</span>
                Destination (end)
              </div>
            </div>
            <p className="mb-1 font-semibold text-slate-700 dark:text-slate-100">Corridor forecast dots</p>
            <p className="mb-2 text-[11px] leading-snug text-slate-500 dark:text-slate-400">
              Larger colored circles = weather at the selected forecast hour along the corridor
              (not the truck ETA checkpoint risk on route cards).
            </p>
            {heatmapOverlay === 'risk' ? (
              <>
                <p className="mb-1 font-semibold text-slate-700 dark:text-slate-100">Overlay · combined risk</p>
                <div className="mb-2 flex flex-wrap gap-x-2 gap-y-1">
                  {(['Low', 'Moderate', 'High', 'Severe', 'No Travel', 'Unavailable'] as const).map((label) => (
                    <span key={label} className="inline-flex items-center gap-1 text-slate-600 dark:text-slate-300">
                      <span
                        className="inline-block h-2.5 w-2.5 rounded-full ring-1 ring-white dark:ring-slate-800"
                        style={{ backgroundColor: riskColor(label) }}
                      />
                      {label}
                    </span>
                  ))}
                </div>
              </>
            ) : (
              <>
                <p className="mb-1 font-semibold text-slate-700 dark:text-slate-100">
                  Overlay · {heatmapOverlay === 'wind' ? 'wind (mph)' : heatmapOverlay === 'rain' ? 'rain (in/hr)' : 'snow (in/hr)'}
                </p>
                <div className="mb-2 space-y-1 text-slate-600 dark:text-slate-300">
                  {(heatmapOverlay === 'wind'
                    ? [
                        { color: '#22c55e', label: '< 25' },
                        { color: '#eab308', label: '25–34' },
                        { color: '#f97316', label: '35–44' },
                        { color: '#ef4444', label: '45–54' },
                        { color: '#7f1d1d', label: '≥ 55' },
                      ]
                    : heatmapOverlay === 'rain'
                      ? [
                          { color: '#22c55e', label: '< 0.10' },
                          { color: '#eab308', label: '0.10–0.24' },
                          { color: '#f97316', label: '0.25–0.49' },
                          { color: '#ef4444', label: '0.50–1.00' },
                          { color: '#7f1d1d', label: '> 1.00' },
                        ]
                      : [
                          { color: '#22c55e', label: '< 0.5' },
                          { color: '#eab308', label: '0.5–0.9' },
                          { color: '#f97316', label: '1.0–1.9' },
                          { color: '#ef4444', label: '2.0–3.0' },
                          { color: '#7f1d1d', label: '> 3.0' },
                        ]
                  ).map((band) => (
                    <span key={band.label} className="mr-2 inline-flex items-center gap-1">
                      <span
                        className="inline-block h-2.5 w-2.5 rounded-full ring-1 ring-white dark:ring-slate-800"
                        style={{ backgroundColor: band.color }}
                      />
                      {band.label}
                    </span>
                  ))}
                  <span className="inline-flex items-center gap-1">
                    <span
                      className="inline-block h-2.5 w-2.5 rounded-full ring-1 ring-white dark:ring-slate-800"
                      style={{ backgroundColor: riskColor('Unavailable') }}
                    />
                    Unavailable
                  </span>
                </div>
              </>
            )}
            <p className="mb-1 font-semibold text-slate-700 dark:text-slate-100">Checkpoint risk (ETA-matched)</p>
            <div className="flex flex-wrap gap-x-2 gap-y-1">
              {(['Low', 'Moderate', 'High', 'Severe', 'No Travel', 'Unavailable'] as const).map((label) => (
                <span key={label} className="inline-flex items-center gap-1 text-slate-600 dark:text-slate-300">
                  <span
                    className="inline-block h-2.5 w-2.5 rounded-full ring-1 ring-white dark:ring-slate-800"
                    style={{ backgroundColor: riskColor(label) }}
                  />
                  {label}
                </span>
              ))}
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setLegendOpen(true)}
            className="pointer-events-auto flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white/95 px-2.5 py-1.5 text-[11px] font-semibold text-slate-700 shadow-sm hover:bg-white dark:border-slate-600 dark:bg-slate-900/95 dark:text-slate-100 dark:hover:bg-slate-800"
            aria-label="Show map legend"
          >
            <span
              className="inline-block h-2.5 w-2.5 rounded-full ring-1 ring-white dark:ring-slate-800"
              style={{ backgroundColor: riskColor('Low') }}
            />
            Legend
          </button>
        )}
      </div>

      {/* Empty / loading / error overlays */}
      {loading && (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-slate-100/70 backdrop-blur-[1px] dark:bg-slate-950/70">
          <div className="flex items-center gap-3 rounded-lg border border-sky-200 bg-white px-4 py-3 text-sm text-sky-900 shadow dark:border-sky-800 dark:bg-slate-900 dark:text-sky-100">
            <span className="spinner" aria-hidden />
            Drawing weather-aware routes…
          </div>
        </div>
      )}

      {empty && (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center">
          <div className="mx-6 max-w-sm rounded-xl border border-dashed border-slate-300 bg-white/90 px-5 py-6 text-center shadow-sm dark:border-slate-600 dark:bg-slate-900/90">
            <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">No route on the map yet</p>
            <p className="mt-1.5 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
              Analyze a trip to draw the recommended road path, alternatives, and weather checkpoints.
            </p>
          </div>
        </div>
      )}

      {geometryError && (
        <div className="absolute top-3 right-3 left-3 z-20 mx-auto max-w-md rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 shadow sm:left-auto dark:border-red-800 dark:bg-red-950/50 dark:text-red-200">
          {geometryError}
        </div>
      )}
    </div>
  )
}

function MapBtn({
  children,
  onClick,
  title,
  active,
  disabled,
}: {
  children: ReactNode
  onClick: () => void
  title?: string
  active?: boolean
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      onClick={onClick}
      className={`rounded px-2 py-1.5 text-[11px] font-medium transition disabled:opacity-40 ${
        active
          ? 'bg-slate-900 text-white dark:bg-sky-500 dark:text-slate-950'
          : 'bg-slate-50 text-slate-700 hover:bg-slate-100 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700'
      }`}
    >
      {children}
    </button>
  )
}

function LegendLine({
  color,
  label,
  solid,
  dashed,
}: {
  color: string
  label: string
  solid?: boolean
  dashed?: boolean
}) {
  return (
    <div className="flex items-center gap-2">
      <span
        className="inline-block h-1 w-7 rounded"
        style={{
          backgroundColor: solid ? color : 'transparent',
          backgroundImage: dashed
            ? `repeating-linear-gradient(90deg, ${color} 0 6px, transparent 6px 10px)`
            : undefined,
          height: 3,
        }}
      />
      {label}
    </div>
  )
}
