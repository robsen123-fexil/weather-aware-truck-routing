import { useState } from 'react'
import type { AnalyzeRoutesResponse } from '../types/routing'
import { formatDuration, formatEta } from '../lib/riskColors'
import {
  conciseRecommendationWhy,
  formatArrival,
  routeNumber,
  safetyStatus,
} from '../lib/routeStats'
import { shortPlaceLabel, userFacingWarning } from '../lib/userMessages'
import { RouteCard } from './RouteCard'
import { RouteCompareTable } from './RouteCompareTable'

const ASSUMPTION_LABELS: Record<string, string> = {
  risk_miles: 'Risk-mile methodology',
  eta: 'Checkpoint ETA estimate',
  forecast_match: 'Forecast matching',
  overall_risk: 'Overall checkpoint risk',
  no_travel: 'No Travel & confidence',
}

interface RouteComparisonProps {
  trip: AnalyzeRoutesResponse
  selectedRouteId: string | null
  onSelect: (id: string) => void
}

export function RouteComparison({ trip, selectedRouteId, onSelect }: RouteComparisonProps) {
  const [methodologyOpen, setMethodologyOpen] = useState(false)
  const { routes, recommendation, request, geocoded, warnings, assumptions } = trip
  const departureIso = request.departure
  const recommended =
    routes.find((r) => r.id === recommendation.recommended_route_id) ?? null
  const ranked = [...routes].sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99))

  const originLabel = shortPlaceLabel(geocoded.origin.label || request.origin)
  const destLabel = shortPlaceLabel(geocoded.destination.label || request.destination)

  return (
    <section className="space-y-5">
      {/* Trip overview */}
      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-900 dark:shadow-none">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Trip overview</p>
        <h2 className="mt-1 text-lg font-semibold text-slate-900 dark:text-slate-50">
          {originLabel}
          <span className="mx-2 font-normal text-slate-400 dark:text-slate-500">→</span>
          {destLabel}
        </h2>
        <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-3 lg:grid-cols-6">
          <OverviewItem label="Departure" value={formatEta(departureIso)} />
          <OverviewItem
            label="Routes analyzed"
            value={`${routes.length} of 3`}
          />
          <OverviewItem
            label="Recommended"
            value={recommended ? `Route ${routeNumber(recommended)}` : 'None'}
          />
          {recommended && (
            <>
              <OverviewItem
                label="Distance"
                value={`${recommended.distance_miles.toFixed(1)} mi`}
              />
              <OverviewItem
                label="Duration"
                value={formatDuration(recommended.duration_minutes)}
              />
              <OverviewItem
                label="Arrival"
                value={formatArrival(recommended, departureIso) ?? '—'}
              />
            </>
          )}
        </dl>
        {recommended && (
          <>
            <p className="mt-3 text-sm text-slate-700 dark:text-slate-300">
              <span className="font-medium text-slate-900 dark:text-slate-100">Route safety: </span>
              {safetyStatus(recommended).label}
              {recommendation.confidence && (
                <span className="text-slate-500 dark:text-slate-400">
                  {' · '}
                  Forecast confidence: {recommendation.confidence}
                </span>
              )}
            </p>
            <p className="mt-1.5 text-xs leading-relaxed text-slate-600 dark:text-slate-400">
              <span className="font-medium text-slate-800 dark:text-slate-200">Why this route: </span>
              {conciseRecommendationWhy(recommended)}
            </p>
          </>
        )}
        {!recommendation.safe_recommendation_available && (
          <p className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-800 dark:bg-red-950/40 dark:text-red-200">
            No route is recommended as safe under current weather and load rules. Compare options below before departing.
          </p>
        )}
        {warnings.length > 0 && (
          <ul className="mt-3 space-y-1 text-xs text-amber-800 dark:text-amber-200">
            {warnings.map((w) => (
              <li key={w}>• {userFacingWarning(w)}</li>
            ))}
          </ul>
        )}

        {assumptions && Object.keys(assumptions).length > 0 && (
          <div className="mt-3 border-t border-slate-100 pt-2 dark:border-slate-700">
            <button
              type="button"
              onClick={() => setMethodologyOpen((v) => !v)}
              className="flex items-center gap-1 text-xs font-medium text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
              aria-expanded={methodologyOpen}
            >
              <span>{methodologyOpen ? '▾' : '▸'}</span>
              How distance, ETA, and risk are calculated
            </button>
            {methodologyOpen && (
              <dl className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                {Object.entries(assumptions).map(([key, text]) => (
                  <div key={key} className="rounded-md bg-slate-50 p-2 dark:bg-slate-800/80">
                    <dt className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                      {ASSUMPTION_LABELS[key] ?? key}
                    </dt>
                    <dd className="mt-0.5 text-[11px] leading-snug text-slate-600 dark:text-slate-300">{text}</dd>
                  </div>
                ))}
              </dl>
            )}
          </div>
        )}
      </div>

      <div>
        <h3 className="mb-2 text-sm font-semibold text-slate-900 dark:text-slate-100">Quick comparison</h3>
        <RouteCompareTable
          routes={routes}
          recommendation={recommendation}
          selectedRouteId={selectedRouteId}
          departureIso={departureIso}
          onSelect={onSelect}
        />
      </div>

      <div className="space-y-3">
        <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Route details</h3>
        <p className="text-xs text-slate-500 dark:text-slate-400">
          Select a route to inspect it on the map. The recommended route is chosen for safety, not because you selected it.
        </p>
        {ranked.map((route, index) => (
          <RouteCard
            key={route.id}
            route={route}
            index={index}
            selected={route.id === selectedRouteId}
            recommendedId={recommendation.recommended_route_id}
            departureIso={departureIso}
            onSelect={onSelect}
          />
        ))}
      </div>
    </section>
  )
}

function OverviewItem({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[10px] font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">{label}</dt>
      <dd className="font-semibold text-slate-900 dark:text-slate-100">{value}</dd>
    </div>
  )
}
