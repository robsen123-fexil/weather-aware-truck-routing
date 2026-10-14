import type { AnalyzedRoute, Checkpoint, RiskLabel } from '../types/routing'
import { formatDuration, formatEta } from './riskColors'

const RISK_ORDER: RiskLabel[] = ['Low', 'Moderate', 'High', 'Severe', 'No Travel']
const RISK_RANK: Record<string, number> = {
  Low: 0,
  Moderate: 1,
  High: 2,
  Severe: 3,
  'No Travel': 4,
}

/** Human label for where a checkpoint sits along the trip (used to explain peak-risk badges). */
export function checkpointLocationLabel(cp: Checkpoint): string {
  if (cp.is_origin) return 'at departure'
  if (cp.is_destination) return 'at destination'
  return `at mi ${cp.distance_from_origin_miles.toFixed(1)}`
}

/**
 * The earliest checkpoint matching the route's highest_risk label.
 * highest_risk is intentionally computed across ALL checkpoints, including the
 * origin (which contributes 0 risk-miles by the segment-mile methodology) so a
 * real hazard right at departure is never silently dropped. This helper lets the
 * UI say *where* that peak was observed instead of leaving it unexplained next
 * to a 0-mile risk bucket.
 */
export function peakRiskCheckpoint(route: AnalyzedRoute): Checkpoint | null {
  const label = route.risk_summary.highest_risk
  if (!label || label === 'Unavailable') return null
  const matches = route.checkpoints.filter((cp) => cp.risk?.overall_risk === label)
  if (matches.length === 0) return null
  return matches.reduce((earliest, cp) =>
    cp.distance_from_origin_miles < earliest.distance_from_origin_miles ? cp : earliest,
  )
}

export function averageRiskMeaning(score: number): string {
  if (score < 0.5) return 'mostly Low'
  if (score < 1.5) return 'around Moderate'
  if (score < 2.5) return 'around High'
  if (score < 3.5) return 'around Severe'
  return 'includes No Travel'
}

export function arrivalIso(route: AnalyzedRoute, departureIso?: string): string | null {
  const lastCp = route.checkpoints[route.checkpoints.length - 1]
  if (lastCp?.eta) return lastCp.eta
  if (!departureIso) return null
  try {
    const dep = new Date(departureIso)
    if (Number.isNaN(dep.getTime())) return null
    return new Date(dep.getTime() + route.duration_seconds * 1000).toISOString()
  } catch {
    return null
  }
}

export function countCheckpointsByRisk(checkpoints: Checkpoint[], labels: string[]): number {
  return checkpoints.filter((cp) => labels.includes(cp.risk?.overall_risk)).length
}

/**
 * Hazards observed at High/Severe among any checkpoint (including the origin),
 * each labeled with the earliest location it was observed so a hazard found
 * only at departure is never confused with one found along the traveled road.
 */
export function mainHazards(route: AnalyzedRoute): string[] {
  const earliest = new Map<string, Checkpoint>()
  const record = (label: string, cp: Checkpoint) => {
    const existing = earliest.get(label)
    if (!existing || cp.distance_from_origin_miles < existing.distance_from_origin_miles) {
      earliest.set(label, cp)
    }
  }
  for (const cp of route.checkpoints) {
    const risk = cp.risk
    if (!risk || risk.overall_risk === 'Unavailable') continue
    if (RISK_ORDER.indexOf(risk.wind_risk as RiskLabel) >= RISK_ORDER.indexOf('High')) {
      record('High wind', cp)
    }
    if (RISK_ORDER.indexOf(risk.rain_risk as RiskLabel) >= RISK_ORDER.indexOf('High')) {
      record('Heavy rain', cp)
    }
    if (RISK_ORDER.indexOf(risk.snow_risk as RiskLabel) >= RISK_ORDER.indexOf('High')) {
      record('Heavy snow', cp)
    }
    if (risk.load_adjusted) record('Load-adjusted wind', cp)
  }
  return [...earliest.entries()].map(
    ([label, cp]) => `${label} (${checkpointLocationLabel(cp)})`,
  )
}

export function safetyStatus(route: AnalyzedRoute): {
  label: string
  tone: 'safe' | 'caution' | 'unsafe' | 'unknown'
} {
  const rs = route.risk_summary
  if (rs.has_no_travel || rs.no_travel_miles > 0) {
    return { label: 'No Travel — unsafe', tone: 'unsafe' }
  }
  const coverage = rs.forecast_coverage?.coverage_percent ?? 100
  if (coverage <= 0 || (rs.has_incomplete_forecast && (rs.evaluated_miles ?? 0) <= 0)) {
    return { label: 'Forecast incomplete', tone: 'unknown' }
  }
  if (rs.has_incomplete_forecast) {
    return { label: 'Partial forecast', tone: 'caution' }
  }
  // highest_risk is computed across ALL checkpoints, including the origin (which
  // contributes 0 risk-miles). A High/Severe reading there must still downgrade
  // the headline safety label — never claim "safe" just because the bucketed
  // mileage happens to be zero for a 0-mile segment.
  const peakRank = rs.highest_risk ? (RISK_RANK[rs.highest_risk] ?? -1) : -1
  if (rs.severe_miles > 0 || rs.high_miles > 0 || peakRank >= RISK_RANK.High) {
    return { label: 'Travel with caution', tone: 'caution' }
  }
  return { label: 'Safe to travel', tone: 'safe' }
}

export function conciseRecommendationWhy(route: AnalyzedRoute): string {
  const rs = route.risk_summary
  const coverage = rs.forecast_coverage
  const parts: string[] = []
  if (rs.severe_miles === 0 && rs.high_miles === 0) {
    parts.push('no severe or high-risk miles among evaluated segments')
  } else {
    parts.push(
      `fewest severe (${rs.severe_miles.toFixed(1)} mi) and high-risk (${rs.high_miles.toFixed(1)} mi) segments`,
    )
  }
  parts.push(`average risk ${rs.average_risk.toFixed(2)} (${averageRiskMeaning(rs.average_risk)})`)
  parts.push(`travel time ${formatDuration(route.duration_minutes)}`)
  let text = `Ranked first for ${parts.join(', ')}.`
  if (coverage) {
    text += ` Forecast coverage ${coverage.coverage_percent}% (${coverage.checkpoints_with_forecast}/${coverage.checkpoints_total} checkpoints).`
  }
  if (rs.has_incomplete_forecast) {
    text += ' Some checkpoints could not be evaluated and are not treated as Low.'
  }
  const peakRank = rs.highest_risk ? (RISK_RANK[rs.highest_risk] ?? -1) : -1
  if (peakRank >= RISK_RANK.High) {
    const peak = peakRiskCheckpoint(route)
    text += ` Note: a ${rs.highest_risk} reading was observed ${
      peak ? checkpointLocationLabel(peak) : 'along this route'
    } — review checkpoint details before departing.`
  }
  return text
}

export function formatArrival(route: AnalyzedRoute, departureIso?: string): string | null {
  const iso = arrivalIso(route, departureIso)
  return iso ? formatEta(iso) : null
}

export function routeNumber(route: AnalyzedRoute, fallbackIndex = 0): number {
  return route.rank ?? fallbackIndex + 1
}

/** User-facing routing source (avoid raw provider ids in the UI). */
export function routingProfileLabel(route: AnalyzedRoute): string {
  if (route.provider === 'openrouteservice') {
    return route.profile?.includes('hgv') ? 'Truck (HGV)' : 'Road network'
  }
  if (route.provider === 'osrm') return 'Road network'
  return 'Road network'
}

/** @deprecated prefer routingProfileLabel in user-facing UI */
export function providerLabel(route: AnalyzedRoute): string {
  return routingProfileLabel(route)
}

export function formatWeatherValue(
  value: number | null | undefined,
  digits: number,
  suffix: string,
): string {
  if (value == null || Number.isNaN(value)) return 'n/a'
  return `${value.toFixed(digits)} ${suffix}`
}
