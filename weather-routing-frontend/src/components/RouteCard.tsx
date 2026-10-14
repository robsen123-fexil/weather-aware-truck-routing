import { useState } from 'react'
import type { AnalyzedRoute } from '../types/routing'
import { formatDuration, formatEta, riskColor, ROUTE_LINE_COLORS } from '../lib/riskColors'
import {
  averageRiskMeaning,
  checkpointLocationLabel,
  countCheckpointsByRisk,
  formatArrival,
  mainHazards,
  peakRiskCheckpoint,
  routeNumber,
  routingProfileLabel,
  safetyStatus,
} from '../lib/routeStats'
import { formatWeatherValue } from '../lib/routeStats'
import { CheckpointWeatherTable } from './CheckpointWeatherTable'

interface RouteCardProps {
  route: AnalyzedRoute
  index: number
  selected: boolean
  recommendedId?: string | null
  departureIso?: string
  onSelect: (id: string) => void
}

export function RouteCard({
  route,
  index,
  selected,
  recommendedId,
  departureIso,
  onSelect,
}: RouteCardProps) {
  const [detailsOpen, setDetailsOpen] = useState(false)
  const rs = route.risk_summary
  const ws = route.weather_summary
  const coverage = rs.forecast_coverage
  const isRecommended = recommendedId === route.id
  const displayNum = routeNumber(route, index)
  const lineColor = ROUTE_LINE_COLORS[index % ROUTE_LINE_COLORS.length]!
  const safety = safetyStatus(route)
  const arrival = formatArrival(route, departureIso)
  const severeHighCps = countCheckpointsByRisk(route.checkpoints, [
    'Severe',
    'High',
    'No Travel',
  ])
  const unavailableCps = countCheckpointsByRisk(route.checkpoints, ['Unavailable'])
  const hazards = mainHazards(route)
  const noTravelCount = rs.no_travel_segments?.length ?? 0
  const peakCp = peakRiskCheckpoint(route)
  const peakAtZeroMiles = Boolean(peakCp?.is_origin && rs.high_miles === 0 && rs.severe_miles === 0)
  const hasPeakWeather =
    ws && (ws.peak_wind_mph != null || ws.peak_rain_in_hr != null || ws.peak_snow_in_hr != null)

  const safetyClass =
    safety.tone === 'safe'
      ? 'bg-emerald-50 text-emerald-800 ring-emerald-200'
      : safety.tone === 'caution'
        ? 'bg-amber-50 text-amber-900 ring-amber-200'
        : safety.tone === 'unknown'
          ? 'bg-slate-100 text-slate-700 ring-slate-200'
          : 'bg-red-50 text-red-800 ring-red-200'

  return (
    <div
      className={`w-full rounded-xl border p-4 transition ${
        isRecommended
          ? 'border-emerald-300 bg-gradient-to-br from-emerald-50/80 to-white shadow-sm'
          : 'border-slate-200 bg-white'
      } ${selected ? 'ring-2 ring-sky-500 ring-offset-1' : ''}`}
    >
      {/* Header */}
      <div className="mb-3 flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-start gap-2.5">
          <span
            className="mt-1 inline-block h-3 w-3 shrink-0 rounded-full"
            style={{ backgroundColor: lineColor }}
            aria-hidden
          />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-sm font-semibold text-slate-900">
                Route {displayNum}
              </p>
              {selected && (
                <span className="rounded bg-sky-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-sky-800">
                  On map
                </span>
              )}
              {rs.highest_risk && (
                <span
                  className="rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white"
                  style={{ backgroundColor: riskColor(rs.highest_risk) }}
                  title={peakCp ? `Observed ${checkpointLocationLabel(peakCp)}` : undefined}
                >
                  Peak {rs.highest_risk}
                  {peakCp ? ` · ${checkpointLocationLabel(peakCp)}` : ''}
                </span>
              )}
            </div>
            <p className="truncate text-xs text-slate-500">
              {routingProfileLabel(route)}
            </p>
          </div>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          {isRecommended && (
            <span className="rounded-full bg-emerald-600 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">
              Recommended
            </span>
          )}
          <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1 ${safetyClass}`}>
            {safety.label}
          </span>
        </div>
      </div>

      {/* Travel summary */}
      <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <MetricBlock label="Distance" value={`${route.distance_miles.toFixed(1)} mi`} />
        <MetricBlock label="Duration" value={formatDuration(route.duration_minutes)} />
        <MetricBlock
          label="Departure"
          value={departureIso ? formatEta(departureIso) : '—'}
        />
        <MetricBlock label="Arrival" value={arrival ?? '—'} />
      </div>

      {/* Weather & risk */}
      <div className="mb-3 rounded-lg border border-slate-100 bg-slate-50/80 p-2.5">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
            Weather risk miles
          </p>
          {coverage && (
            <p className="text-[11px] text-slate-600">
              <strong className="text-slate-900">{coverage.coverage_percent}%</strong> forecast coverage
              {' '}({coverage.checkpoints_with_forecast}/{coverage.checkpoints_total} checkpoints)
            </p>
          )}
        </div>

        {rs.has_incomplete_forecast && (
          <div className="mb-2 rounded-md border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-[11px] leading-snug text-amber-950">
            Forecast coverage is incomplete. Safety conclusions apply only to evaluated segments
            {rs.evaluated_miles != null
              ? ` (${rs.evaluated_miles.toFixed(1)} of ${route.distance_miles.toFixed(1)} mi)`
              : ''}
            . Missing forecasts are not treated as Low.
          </div>
        )}

        {rs.has_no_travel && (
          <div className="mb-2 rounded-md border border-red-200 bg-red-50 px-2.5 py-1.5 text-[11px] font-medium leading-snug text-red-900">
            No Travel hazard on this route
            {rs.no_travel_miles > 0 ? ` · ${rs.no_travel_miles.toFixed(1)} mi` : ''}
            . Not eligible as a safe recommendation.
          </div>
        )}

        <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 sm:grid-cols-3">
          <RiskMile label="Severe" miles={rs.severe_miles} color={riskColor('Severe')} />
          <RiskMile label="High" miles={rs.high_miles} color={riskColor('High')} />
          <RiskMile label="Moderate" miles={rs.moderate_miles} color={riskColor('Moderate')} />
          <RiskMile label="Low" miles={rs.low_miles} color={riskColor('Low')} />
          <RiskMile label="No Travel" miles={rs.no_travel_miles} color={riskColor('No Travel')} />
          <RiskMile
            label="Unavailable"
            miles={rs.unavailable_miles ?? 0}
            color={riskColor('Unavailable')}
          />
          <div>
            <p className="text-[10px] uppercase tracking-wide text-slate-500">Avg risk</p>
            <p className="text-sm font-semibold text-slate-900">
              {rs.average_risk.toFixed(2)}
              <span className="ml-1 text-[10px] font-normal text-slate-500">
                / 4 · {averageRiskMeaning(rs.average_risk)}
              </span>
            </p>
          </div>
        </div>
        <p className="mt-1.5 text-[10px] leading-snug text-slate-500">
          Risk miles classify each traveled segment by the forecast at its ending checkpoint.
          Total distance {route.distance_miles.toFixed(1)} mi
          {rs.evaluated_miles != null
            ? ` · evaluated ${rs.evaluated_miles.toFixed(1)} mi`
            : ` · scored ${rs.total_risk_miles.toFixed(1)} mi`}
          .
        </p>

        {hasPeakWeather && (
          <p className="mt-2 border-t border-slate-200/80 pt-2 text-[11px] text-slate-700">
            Measured peak:{' '}
            <strong>{formatWeatherValue(ws!.peak_wind_mph, 1, 'mph wind')}</strong>
            {' · '}
            <strong>{formatWeatherValue(ws!.peak_rain_in_hr, 3, 'in/hr rain')}</strong>
            {' · '}
            <strong>{formatWeatherValue(ws!.peak_snow_in_hr, 3, 'in/hr snow')}</strong>
          </p>
        )}

        <div className="mt-2 space-y-1 border-t border-slate-200/80 pt-2 text-xs text-slate-600">
          {rs.highest_risk && peakCp && (
            <p>
              Highest risk encountered:{' '}
              <span className="font-semibold" style={{ color: riskColor(rs.highest_risk) }}>
                {rs.highest_risk}
              </span>
              {' '}({checkpointLocationLabel(peakCp)})
              {peakAtZeroMiles && (
                <span className="text-slate-500">
                  {' '}— this checkpoint contributes 0 risk-miles below because it is the
                  starting point, not a traveled segment. It is still shown so this condition
                  is never hidden.
                </span>
              )}
            </p>
          )}
          {severeHighCps > 0 && (
            <p>
              <span className="font-medium text-orange-700">{severeHighCps}</span> checkpoint
              {severeHighCps === 1 ? '' : 's'} with high/severe/no-travel risk
            </p>
          )}
          {unavailableCps > 0 && (
            <p>
              <span className="font-medium text-slate-800">{unavailableCps}</span> checkpoint
              {unavailableCps === 1 ? '' : 's'} without forecast (not counted as Low)
            </p>
          )}
          {noTravelCount > 0 && (
            <p className="text-red-700">
              {noTravelCount} No Travel segment{noTravelCount === 1 ? '' : 's'}
              {' '}({rs.no_travel_miles.toFixed(1)} mi)
            </p>
          )}
          {hazards.length > 0 ? (
            <p>
              Main hazards:{' '}
              <span className="font-medium text-slate-800">{hazards.join(', ')}</span>
            </p>
          ) : coverage && coverage.checkpoints_with_forecast === 0 ? (
            <p>No evaluated weather hazards — forecasts missing.</p>
          ) : rs.highest_risk && rs.highest_risk !== 'Low' ? (
            <p className="text-amber-700">
              No High or Severe hazards on evaluated segments. A {rs.highest_risk} reading was
              recorded{peakCp ? ` ${checkpointLocationLabel(peakCp)}` : ''} — see above.
            </p>
          ) : (
            <p className="text-emerald-700">
              Confirmed Low conditions on evaluated segments
              {coverage ? ` (${coverage.checkpoints_with_forecast} checkpoints)` : ''}.
            </p>
          )}
          {route.warnings?.length > 0 && (
            <p className="text-amber-800">{route.warnings.join(' · ')}</p>
          )}
        </div>
      </div>

      {/* Actions */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-3">
        <button
          type="button"
          onClick={() => setDetailsOpen((v) => !v)}
          className="flex items-center gap-1 rounded-md px-1 py-1 text-xs font-semibold text-sky-800 hover:bg-sky-50"
          aria-expanded={detailsOpen}
        >
          <span className="text-slate-400">{detailsOpen ? '▾' : '▸'}</span>
          Checkpoint-by-checkpoint weather ({route.checkpoints.length})
        </button>
        <button
          type="button"
          onClick={() => onSelect(route.id)}
          disabled={selected}
          className={`rounded-md px-3 py-1.5 text-xs font-semibold transition ${
            selected
              ? 'cursor-default bg-sky-100 text-sky-700'
              : 'bg-slate-900 text-white hover:bg-slate-800'
          }`}
        >
          {selected ? 'Viewing on map' : 'View on map'}
        </button>
      </div>

      {detailsOpen && (
        <div className="mt-3">
          <CheckpointWeatherTable checkpoints={route.checkpoints} weatherSummary={ws} />
        </div>
      )}
    </div>
  )
}

function MetricBlock({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-slate-100 bg-white px-2 py-1.5">
      <p className="text-[10px] uppercase tracking-wide text-slate-500">{label}</p>
      <p className="text-sm font-semibold text-slate-900">{value}</p>
    </div>
  )
}

function RiskMile({
  label,
  miles,
  color,
}: {
  label: string
  miles: number
  color: string
}) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: color }} />
      <div>
        <p className="text-[10px] uppercase tracking-wide text-slate-500">{label}</p>
        <p className="text-sm font-semibold text-slate-900">{miles.toFixed(1)} mi</p>
      </div>
    </div>
  )
}
