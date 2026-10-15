import type { ReactNode } from 'react'
import type { AnalyzedRoute, Recommendation } from '../types/routing'
import { formatDuration } from '../lib/riskColors'
import { formatArrival, mainHazards, routingProfileLabel, safetyStatus } from '../lib/routeStats'

const SLOT_COUNT = 3

interface RouteCompareTableProps {
  routes: AnalyzedRoute[]
  recommendation: Recommendation
  selectedRouteId: string | null
  departureIso?: string
  onSelect: (id: string) => void
}

export function RouteCompareTable({
  routes,
  recommendation,
  selectedRouteId,
  departureIso,
  onSelect,
}: RouteCompareTableProps) {
  const ranked = [...routes].sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99))
  const slots: (AnalyzedRoute | null)[] = []
  for (let i = 0; i < SLOT_COUNT; i += 1) {
    slots.push(ranked[i] ?? null)
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900">
      <table className="w-full min-w-[640px] border-collapse text-left text-xs">
        <thead>
          <tr className="border-b border-slate-100 bg-slate-50/80 dark:border-slate-700 dark:bg-slate-800/80">
            <th className="px-3 py-2.5 font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Metric</th>
            {slots.map((route, i) => (
              <th key={i} className="px-3 py-2.5 font-semibold text-slate-800 dark:text-slate-100">
                Route {i + 1}
                {!route && (
                  <span className="mt-0.5 block text-[10px] font-normal text-slate-400 dark:text-slate-500">Not available</span>
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
          <Row label="Status">
            {slots.map((route, i) => {
              if (!route) return <Cell key={i}>—</Cell>
              const isRec = recommendation.recommended_route_id === route.id
              const isSel = selectedRouteId === route.id
              return (
                <Cell key={i}>
                  <div className="flex flex-wrap gap-1">
                    {isRec && (
                      <Badge tone="emerald">Recommended</Badge>
                    )}
                    {isSel && (
                      <Badge tone="sky">Selected</Badge>
                    )}
                    {!isRec && !isSel && (
                      <span className="text-slate-500 dark:text-slate-400">Alternative</span>
                    )}
                  </div>
                </Cell>
              )
            })}
          </Row>
          <Row label="Profile">
            {slots.map((route, i) => (
              <Cell key={i}>{route ? routingProfileLabel(route) : '—'}</Cell>
            ))}
          </Row>
          <Row label="Distance">
            {slots.map((route, i) => (
              <Cell key={i}>{route ? `${route.distance_miles.toFixed(1)} mi` : '—'}</Cell>
            ))}
          </Row>
          <Row label="Duration">
            {slots.map((route, i) => (
              <Cell key={i}>{route ? formatDuration(route.duration_minutes) : '—'}</Cell>
            ))}
          </Row>
          <Row label="Arrival">
            {slots.map((route, i) => (
              <Cell key={i}>{route ? (formatArrival(route, departureIso) ?? '—') : '—'}</Cell>
            ))}
          </Row>
          <Row label="Safety">
            {slots.map((route, i) => (
              <Cell key={i}>{route ? safetyStatus(route).label : '—'}</Cell>
            ))}
          </Row>
          <Row label="Severe mi">
            {slots.map((route, i) => (
              <Cell key={i} highlight={route?.risk_summary.severe_miles}>
                {route ? route.risk_summary.severe_miles.toFixed(1) : '—'}
              </Cell>
            ))}
          </Row>
          <Row label="High mi">
            {slots.map((route, i) => (
              <Cell key={i} highlight={route?.risk_summary.high_miles}>
                {route ? route.risk_summary.high_miles.toFixed(1) : '—'}
              </Cell>
            ))}
          </Row>
          <Row label="Moderate mi">
            {slots.map((route, i) => (
              <Cell key={i}>{route ? route.risk_summary.moderate_miles.toFixed(1) : '—'}</Cell>
            ))}
          </Row>
          <Row label="Low mi">
            {slots.map((route, i) => (
              <Cell key={i}>{route ? route.risk_summary.low_miles.toFixed(1) : '—'}</Cell>
            ))}
          </Row>
          <Row label="No Travel mi">
            {slots.map((route, i) => (
              <Cell key={i} highlight={route?.risk_summary.no_travel_miles} danger>
                {route ? route.risk_summary.no_travel_miles.toFixed(1) : '—'}
              </Cell>
            ))}
          </Row>
          <Row label="Unavailable mi">
            {slots.map((route, i) => (
              <Cell key={i}>
                {route ? (route.risk_summary.unavailable_miles ?? 0).toFixed(1) : '—'}
              </Cell>
            ))}
          </Row>
          <Row label="Evaluated mi">
            {slots.map((route, i) => (
              <Cell key={i}>
                {route
                  ? (route.risk_summary.evaluated_miles ?? route.risk_summary.total_risk_miles).toFixed(1)
                  : '—'}
              </Cell>
            ))}
          </Row>
          <Row label="Avg risk">
            {slots.map((route, i) => (
              <Cell key={i}>{route ? route.risk_summary.average_risk.toFixed(2) : '—'}</Cell>
            ))}
          </Row>
          <Row label="Forecast coverage">
            {slots.map((route, i) => {
              const c = route?.risk_summary.forecast_coverage
              const incomplete = route?.risk_summary.has_incomplete_forecast
              return (
                <Cell key={i}>
                  {c
                    ? `${c.coverage_percent}% (${c.checkpoints_with_forecast}/${c.checkpoints_total})`
                    : '—'}
                  {incomplete ? (
                    <span className="mt-0.5 block text-[10px] font-medium text-amber-700 dark:text-amber-300">
                      Incomplete coverage
                    </span>
                  ) : null}
                </Cell>
              )
            })}
          </Row>
          <Row label="Main hazards">
            {slots.map((route, i) => {
              const h = route ? mainHazards(route) : []
              return (
                <Cell key={i}>
                  {route
                    ? (h.length > 0 ? h.join(', ') : 'None on evaluated segments')
                    : '—'}
                </Cell>
              )
            })}
          </Row>
          <tr>
            <td className="px-3 py-2.5 text-slate-500 dark:text-slate-400" />
            {slots.map((route, i) => (
              <td key={i} className="px-3 py-2.5">
                {route ? (
                  <button
                    type="button"
                    onClick={() => onSelect(route.id)}
                    className={`rounded-md px-2.5 py-1.5 text-[11px] font-semibold transition ${
                      selectedRouteId === route.id
                        ? 'bg-sky-600 text-white dark:bg-sky-500 dark:text-slate-950'
                        : 'bg-slate-100 text-slate-800 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700'
                    }`}
                  >
                    {selectedRouteId === route.id ? 'Viewing on map' : 'View on map'}
                  </button>
                ) : null}
              </td>
            ))}
          </tr>
        </tbody>
      </table>
      {routes.length < SLOT_COUNT && (
        <p className="border-t border-slate-100 px-3 py-2 text-[11px] text-slate-500 dark:border-slate-700 dark:text-slate-400">
          {routes.length === 1
            ? 'Only one distinct route was available for this trip.'
            : `Only ${routes.length} distinct routes were available — Route 3 could not be generated.`}
        </p>
      )}
    </div>
  )
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <tr>
      <th className="whitespace-nowrap px-3 py-2 font-medium text-slate-600 dark:text-slate-400">{label}</th>
      {children}
    </tr>
  )
}

function Cell({
  children,
  highlight,
  danger,
}: {
  children: ReactNode
  highlight?: number
  danger?: boolean
}) {
  const warn = highlight != null && highlight > 0
  return (
    <td
      className={`px-3 py-2 ${
        warn
          ? danger
            ? 'font-semibold text-red-800 dark:text-red-300'
            : 'font-semibold text-orange-800 dark:text-orange-300'
          : 'text-slate-800 dark:text-slate-200'
      }`}
    >
      {children}
    </td>
  )
}

function Badge({ children, tone }: { children: ReactNode; tone: 'emerald' | 'sky' }) {
  const cls =
    tone === 'emerald'
      ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-200'
      : 'bg-sky-100 text-sky-800 dark:bg-sky-950/50 dark:text-sky-200'
  return (
    <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${cls}`}>
      {children}
    </span>
  )
}
