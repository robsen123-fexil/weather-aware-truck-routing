import type { CorridorForecastResponse } from '../types/routing'
import { frameSummary, nearestFrame, snapToFrameHour } from '../lib/corridorForecast'

interface ForecastSliderProps {
  forecast: CorridorForecastResponse | null
  hour: number
  onChange: (hour: number) => void
  loading?: boolean
  overlay: 'risk' | 'wind' | 'rain' | 'snow'
  /** True once a trip analysis has completed successfully. */
  hasAnalysis?: boolean
  /** User-facing reason when corridor forecast could not be loaded. */
  error?: string | null
}

export function ForecastSlider({
  forecast,
  hour,
  onChange,
  loading,
  overlay,
  hasAnalysis = false,
  error = null,
}: ForecastSliderProps) {
  if (!forecast || forecast.frames.length === 0) {
    if (loading) {
      return (
        <div className="rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm text-slate-500">
          Loading corridor forecast along your route…
        </div>
      )
    }
    if (error) {
      return (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
          <p className="font-medium">Corridor forecast unavailable</p>
          <p className="mt-1 text-xs leading-relaxed text-amber-900">{error}</p>
        </div>
      )
    }
    if (hasAnalysis) {
      return (
        <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 px-4 py-3 text-sm text-slate-600">
          Corridor forecast samples are not available for this route. Route cards still use
          ETA-matched checkpoint weather for risk scoring.
        </div>
      )
    }
    return (
      <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 px-4 py-3 text-sm text-slate-500">
        Corridor forecast appears after route analysis completes.
      </div>
    )
  }

  const hours = forecast.frames.map((f) => f.hour_offset)
  const min = hours[0] ?? 0
  const max = hours[hours.length - 1] ?? 48
  const step = forecast.step_hours || 1
  const snappedHour = snapToFrameHour(forecast, hour)
  const frame = nearestFrame(forecast, snappedHour)
  const label = frame
    ? new Date(frame.time).toLocaleString(undefined, {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
    : ''

  const availableSamples = frame?.samples.filter((s) => s.weather.available).length ?? 0
  const totalSamples = frame?.samples.length ?? 0
  const unavailableSamples = totalSamples - availableSamples
  const summary = frameSummary(frame, overlay)

  return (
    <div className="rounded-lg border border-slate-200 bg-white px-4 py-3">
      <div className="mb-2 flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Corridor forecast timeline
          </p>
          <p className="text-sm font-medium text-slate-900">
            +{snappedHour}h from departure · {label}
          </p>
          {loading && (
            <p className="mt-0.5 text-[11px] text-sky-700">Refreshing samples for selected route…</p>
          )}
        </div>
        <p className="font-mono text-xs text-slate-500">0–{max}h · every {step}h</p>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={snappedHour}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-sky-600"
        aria-label="Forecast hour offset"
        disabled={loading}
      />
      <p className="mt-2 text-xs leading-relaxed text-slate-700">{summary}</p>
      {unavailableSamples > 0 && (
        <p className="mt-1 text-[11px] text-slate-600">
          {unavailableSamples} sample{unavailableSamples === 1 ? '' : 's'} missing forecast at this
          hour — shown as Unavailable on the map, not as Low risk.
        </p>
      )}
      <p className="mt-1.5 text-[11px] leading-snug text-slate-500">
        This timeline is for exploring weather <strong>along the corridor</strong> at future hours.
        It is separate from checkpoint ETA risk on route cards. Colored dots on the map show these
        samples ({availableSamples}/{totalSamples} available at this hour).
      </p>
    </div>
  )
}
