import type { CorridorForecastResponse, ForecastFrame, ForecastSample } from '../types/routing'
import { formatWeatherValue } from './routeStats'
import { weatherToDisplayRisk } from './riskColors'

export function nearestFrame(
  forecast: CorridorForecastResponse,
  hour: number,
): ForecastFrame | null {
  if (!forecast.frames.length) return null
  let best = forecast.frames[0]!
  let bestDelta = Math.abs(best.hour_offset - hour)
  for (const frame of forecast.frames) {
    const delta = Math.abs(frame.hour_offset - hour)
    if (delta < bestDelta) {
      bestDelta = delta
      best = frame
    }
  }
  return best
}

export function snapToFrameHour(
  forecast: CorridorForecastResponse,
  hour: number,
): number {
  return nearestFrame(forecast, hour)?.hour_offset ?? hour
}

export function frameSummary(
  frame: ForecastFrame | null,
  overlay: 'risk' | 'wind' | 'rain' | 'snow',
): string {
  if (!frame || frame.samples.length === 0) {
    return 'No corridor samples for this hour.'
  }
  const available = frame.samples.filter((s) => s.weather.available)
  if (available.length === 0) {
    return 'No forecast available at corridor samples for this hour.'
  }

  if (overlay === 'wind') {
    const winds = available.map((s) => s.weather.wind_mph).filter((v) => v != null) as number[]
    const avg = winds.reduce((a, b) => a + b, 0) / winds.length
    const max = Math.max(...winds)
    return `Wind along corridor: avg ${avg.toFixed(1)} mph, peak ${max.toFixed(1)} mph (${available.length} samples).`
  }
  if (overlay === 'rain') {
    const vals = available.map((s) => s.weather.rain_in_hr).filter((v) => v != null) as number[]
    const max = Math.max(...vals)
    return `Rain along corridor: peak ${formatWeatherValue(max, 3, 'in/hr')} (${available.length} samples).`
  }
  if (overlay === 'snow') {
    const vals = available.map((s) => s.weather.snow_in_hr).filter((v) => v != null) as number[]
    const max = Math.max(...vals)
    return `Snow along corridor: peak ${formatWeatherValue(max, 3, 'in/hr')} (${available.length} samples).`
  }

  const risks = available.map((s) => weatherToDisplayRisk(s.weather))
  const order = ['Low', 'Moderate', 'High', 'Severe', 'No Travel', 'Unavailable']
  const peak = risks.reduce(
    (a, b) => (order.indexOf(b) > order.indexOf(a) ? b : a),
    risks[0]!,
  )
  return `Combined risk along corridor: highest ${peak} (${available.length} samples).`
}

export function samplePopupLine(
  sample: ForecastSample,
  overlay: 'risk' | 'wind' | 'rain' | 'snow',
): string {
  const w = sample.weather
  if (!w.available) return 'Forecast unavailable'
  if (overlay === 'wind') return `Wind ${formatWeatherValue(w.wind_mph, 1, 'mph')}`
  if (overlay === 'rain') return `Rain ${formatWeatherValue(w.rain_in_hr, 3, 'in/hr')}`
  if (overlay === 'snow') return `Snow ${formatWeatherValue(w.snow_in_hr, 3, 'in/hr')}`
  return `Risk ${weatherToDisplayRisk(w)}`
}

export function overlayColorLabel(overlay: 'risk' | 'wind' | 'rain' | 'snow'): string {
  if (overlay === 'risk') return 'Combined weather risk'
  if (overlay === 'wind') return 'Wind speed bands'
  if (overlay === 'rain') return 'Rain intensity bands'
  return 'Snow intensity bands'
}
