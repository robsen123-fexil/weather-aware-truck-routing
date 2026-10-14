import { useEffect } from 'react'
import type { GeoJSONSource, Map as MaplibreMap } from 'maplibre-gl'
import type { CorridorForecastResponse, ForecastFrame } from '../types/routing'
import { nearestFrame } from '../lib/corridorForecast'
import { riskColor, weatherToDisplayRisk } from '../lib/riskColors'

const SOURCE_ID = 'weather-heatmap'
const CIRCLE_LAYER = 'weather-heatmap-circles'
const HALO_LAYER = 'weather-heatmap-halo'
const UNAVAILABLE = '#64748b'

interface WeatherHeatmapProps {
  map: MaplibreMap | null
  forecast: CorridorForecastResponse | null
  hour: number
  overlay: 'risk' | 'wind' | 'rain' | 'snow'
  /** Bump when route layers redraw so heatmap stays on top. */
  layerEpoch?: number
}

function sampleColor(
  sample: ForecastFrame['samples'][number],
  overlay: WeatherHeatmapProps['overlay'],
): string {
  const w = sample.weather
  if (!w.available) return UNAVAILABLE
  if (overlay === 'risk') return riskColor(weatherToDisplayRisk(w))

  if (overlay === 'wind') {
    if (w.wind_mph == null) return UNAVAILABLE
    if (w.wind_mph < 25) return '#22c55e'
    if (w.wind_mph < 35) return '#eab308'
    if (w.wind_mph < 45) return '#f97316'
    if (w.wind_mph < 55) return '#ef4444'
    return '#7f1d1d'
  }
  if (overlay === 'rain') {
    if (w.rain_in_hr == null) return UNAVAILABLE
    if (w.rain_in_hr < 0.1) return '#22c55e'
    if (w.rain_in_hr < 0.25) return '#eab308'
    if (w.rain_in_hr < 0.5) return '#f97316'
    if (w.rain_in_hr <= 1) return '#ef4444'
    return '#7f1d1d'
  }
  if (w.snow_in_hr == null) return UNAVAILABLE
  if (w.snow_in_hr < 0.5) return '#22c55e'
  if (w.snow_in_hr < 1) return '#eab308'
  if (w.snow_in_hr < 2) return '#f97316'
  if (w.snow_in_hr <= 3) return '#ef4444'
  return '#7f1d1d'
}

function toGeoJSON(
  frame: ForecastFrame,
  overlay: WeatherHeatmapProps['overlay'],
): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: frame.samples.map((s, i) => ({
      type: 'Feature',
      id: i,
      properties: {
        color: sampleColor(s, overlay),
        available: s.weather.available,
      },
      geometry: {
        type: 'Point',
        coordinates: [s.lon, s.lat],
      },
    })),
  }
}

function bringHeatmapToFront(map: MaplibreMap) {
  try {
    if (map.getLayer(HALO_LAYER)) map.moveLayer(HALO_LAYER)
    if (map.getLayer(CIRCLE_LAYER)) map.moveLayer(CIRCLE_LAYER)
  } catch {
    /* layers may not exist yet */
  }
}

export function WeatherHeatmap({ map, forecast, hour, overlay, layerEpoch = 0 }: WeatherHeatmapProps) {
  useEffect(() => {
    if (!map) return

    const ensureLayers = () => {
      if (!map.getSource(SOURCE_ID)) {
        map.addSource(SOURCE_ID, {
          type: 'geojson',
          data: { type: 'FeatureCollection', features: [] },
        })
      }
      if (!map.getLayer(HALO_LAYER)) {
        map.addLayer({
          id: HALO_LAYER,
          type: 'circle',
          source: SOURCE_ID,
          paint: {
            'circle-radius': 36,
            'circle-color': ['get', 'color'],
            'circle-opacity': 0.28,
            'circle-blur': 0.75,
          },
        })
      }
      if (!map.getLayer(CIRCLE_LAYER)) {
        map.addLayer({
          id: CIRCLE_LAYER,
          type: 'circle',
          source: SOURCE_ID,
          paint: {
            'circle-radius': 14,
            'circle-color': ['get', 'color'],
            'circle-opacity': 0.92,
            'circle-stroke-width': 2.5,
            'circle-stroke-color': '#ffffff',
          },
        })
      }
    }

    const update = () => {
      if (!map.isStyleLoaded()) return
      ensureLayers()
      const source = map.getSource(SOURCE_ID) as GeoJSONSource | undefined
      if (!source) return

      if (!forecast) {
        source.setData({ type: 'FeatureCollection', features: [] })
        return
      }
      const frame = nearestFrame(forecast, hour)
      if (!frame) {
        source.setData({ type: 'FeatureCollection', features: [] })
        return
      }
      source.setData(toGeoJSON(frame, overlay))
      bringHeatmapToFront(map)
    }

    update()
    map.on('load', update)
    map.on('styledata', update)
    return () => {
      map.off('load', update)
      map.off('styledata', update)
    }
  }, [map, forecast, hour, overlay, layerEpoch])

  return null
}
