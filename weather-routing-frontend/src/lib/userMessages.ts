import { ApiError } from '../api/client'

/** Map API and network failures to driver-friendly copy (log details separately). */
export function userFacingError(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 0 || err.code === 'network_error') {
      return 'Unable to analyze this trip right now. Check your connection and try again.'
    }
    if (err.status === 400 || err.code === 'validation_error') {
      return 'Please check the origin, destination, and departure time, then try again.'
    }
    if (err.status === 429) {
      return 'Too many requests. Please wait a moment and try again.'
    }
    if (err.status === 503 || err.code === 'routing_error') {
      return 'Route planning is temporarily unavailable. Try again in a few minutes.'
    }
    if (err.status === 502) {
      return 'We could not calculate routes for this trip. Try different locations or try again.'
    }
    if (err.status === 404) {
      return 'No route could be found between those locations.'
    }
    // Avoid echoing raw provider text when it looks technical
    const msg = err.message || ''
    if (/traceback|exception|django|serializer|openrouteservice|osrm|api error/i.test(msg)) {
      return 'Something went wrong while analyzing this trip. Please try again.'
    }
    if (msg.length > 0 && msg.length < 120 && !msg.includes('{')) {
      return msg
    }
    return 'Unable to analyze this trip right now. Please try again.'
  }
  if (err instanceof Error && err.message && !err.message.includes('fetch')) {
    return 'Unable to analyze this trip right now. Please try again.'
  }
  return 'Unable to analyze this trip right now. Please try again.'
}

/** Turn backend warning strings into product language where needed. */
export function userFacingWarning(warning: string): string {
  if (warning.startsWith('routing_alternatives:')) {
    const n = warning.split(':')[1] ?? '2'
    return `The routing service returned ${n} distinct route${n === '1' ? '' : 's'} for this trip (up to 3 when available).`
  }
  if (/Only \d+ route alternative/i.test(warning)) {
    const m = warning.match(/Only (\d+) route alternative/)
    const n = m?.[1] ?? 'fewer'
    return `The routing service returned ${n} distinct alternative${n === '1' ? '' : 's'} for this trip.`
  }
  if (/checkpoints without an available forecast/i.test(warning)) {
    return 'Some checkpoints could not be matched to a weather forecast.'
  }
  if (/Unavailable segments are not counted/i.test(warning)) {
    return 'Missing forecasts are shown separately and are not treated as calm weather.'
  }
  if (/Forecast coverage/i.test(warning)) {
    return warning.replace(/^Forecast coverage/, 'Weather forecast coverage')
  }
  if (/No Travel/i.test(warning)) {
    return warning
  }
  if (/Skipped route/i.test(warning)) {
    return 'One route option could not be analyzed and was omitted.'
  }
  return warning
}

export function shortPlaceLabel(label: string, maxLen = 48): string {
  const trimmed = label.trim()
  if (trimmed.length <= maxLen) return trimmed
  return `${trimmed.slice(0, maxLen - 1)}…`
}
