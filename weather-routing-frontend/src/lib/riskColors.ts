import type { RiskLabel, WeatherMeasurements } from '../types/routing'

/** Display colors for backend risk labels (mirrors the risk-engine severity scale). */
export const RISK_COLORS: Record<string, string> = {
  Low: '#22c55e',
  Moderate: '#eab308',
  High: '#f97316',
  Severe: '#ef4444',
  'No Travel': '#7f1d1d',
  Unavailable: '#64748b',
}

export const ROUTE_LINE_COLORS = ['#2563eb', '#7c3aed', '#0d9488'] as const

export function riskColor(label: string | undefined): string {
  if (!label) return RISK_COLORS.Unavailable!
  return RISK_COLORS[label] ?? RISK_COLORS.Unavailable!
}

/**
 * Derive a display risk label from forecast weather measurements using the
 * same threshold bands as the backend (for heatmap coloring only).
 * Missing forecasts are Unavailable — never Low.
 */
export function weatherToDisplayRisk(weather: WeatherMeasurements): RiskLabel {
  if (!weather.available) return 'Unavailable'
  if (weather.wind_mph == null && weather.rain_in_hr == null && weather.snow_in_hr == null) {
    return 'Unavailable'
  }

  const wind = weather.wind_mph ?? 0
  const rain = weather.rain_in_hr ?? 0
  const snow = weather.snow_in_hr ?? 0

  const windRisk: RiskLabel =
    wind < 25 ? 'Low'
      : wind < 35 ? 'Moderate'
        : wind < 45 ? 'High'
          : wind < 55 ? 'Severe'
            : 'No Travel'

  const rainRisk: RiskLabel =
    rain < 0.1 ? 'Low'
      : rain < 0.25 ? 'Moderate'
        : rain < 0.5 ? 'High'
          : rain <= 1.0 ? 'Severe'
            : 'No Travel'

  const snowRisk: RiskLabel =
    snow < 0.5 ? 'Low'
      : snow < 1.0 ? 'Moderate'
        : snow < 2.0 ? 'High'
          : snow <= 3.0 ? 'Severe'
            : 'No Travel'

  const order: RiskLabel[] = ['Low', 'Moderate', 'High', 'Severe', 'No Travel']
  return order[Math.max(order.indexOf(windRisk), order.indexOf(rainRisk), order.indexOf(snowRisk))]!
}

export function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60)
  const m = Math.round(minutes % 60)
  if (h <= 0) return `${m} min`
  return `${h}h ${m}m`
}

export function formatEta(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return iso
  }
}
