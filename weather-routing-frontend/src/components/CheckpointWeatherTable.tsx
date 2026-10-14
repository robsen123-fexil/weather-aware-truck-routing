import type { Checkpoint, RouteWeatherSummary } from '../types/routing'
import { formatEta, riskColor } from '../lib/riskColors'
import { formatWeatherValue } from '../lib/routeStats'

interface CheckpointWeatherTableProps {
  checkpoints: Checkpoint[]
  weatherSummary?: RouteWeatherSummary
}

export function CheckpointWeatherTable({
  checkpoints,
  weatherSummary,
}: CheckpointWeatherTableProps) {
  const peak = weatherSummary

  return (
    <div className="rounded-lg border border-sky-100 bg-sky-50/40 p-2.5">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-sky-900">
          Checkpoint weather (ETA-matched forecast)
        </p>
        {peak && peak.checkpoints_evaluated > 0 && (
          <p className="text-[11px] text-slate-600">
            Peak: {formatWeatherValue(peak.peak_wind_mph, 1, 'mph wind')}
            {' · '}
            {formatWeatherValue(peak.peak_rain_in_hr, 3, 'in/hr rain')}
            {' · '}
            {formatWeatherValue(peak.peak_snow_in_hr, 3, 'in/hr snow')}
          </p>
        )}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] border-collapse text-left text-[11px]">
          <thead>
            <tr className="border-b border-sky-100 text-[10px] uppercase tracking-wide text-slate-500">
              <th className="px-1.5 py-1">Cp</th>
              <th className="px-1.5 py-1">Mi</th>
              <th className="px-1.5 py-1">Location</th>
              <th className="px-1.5 py-1">Truck ETA</th>
              <th className="px-1.5 py-1">Forecast hr</th>
              <th className="px-1.5 py-1">Wind</th>
              <th className="px-1.5 py-1">Rain</th>
              <th className="px-1.5 py-1">Snow</th>
              <th className="px-1.5 py-1">Overall</th>
              <th className="px-1.5 py-1">Why</th>
            </tr>
          </thead>
          <tbody>
            {checkpoints.map((cp) => {
              const w = cp.weather
              const r = cp.risk
              const avail = w?.available
              return (
                <tr key={cp.index} className="border-b border-sky-50/80 align-top">
                  <td className="px-1.5 py-1 font-medium text-slate-800">{cp.index}</td>
                  <td className="px-1.5 py-1 text-slate-700">
                    {cp.distance_from_origin_miles.toFixed(1)}
                  </td>
                  <td className="whitespace-nowrap px-1.5 py-1 font-mono text-[10px] text-slate-500">
                    {cp.coordinates.lat.toFixed(3)}, {cp.coordinates.lon.toFixed(3)}
                  </td>
                  <td className="px-1.5 py-1 whitespace-nowrap text-slate-700">{formatEta(cp.eta)}</td>
                  <td className="px-1.5 py-1 whitespace-nowrap text-slate-600">
                    {w?.forecast_time ? formatEta(w.forecast_time) : '—'}
                    {w?.forecast_delta_minutes != null ? ` (Δ${w.forecast_delta_minutes}m)` : ''}
                  </td>
                  {avail ? (
                    <>
                      <td className="px-1.5 py-1 text-slate-800">
                        {formatWeatherValue(w.wind_mph, 1, 'mph')}
                        <span className="text-slate-500"> · {r.wind_risk}</span>
                      </td>
                      <td className="px-1.5 py-1 text-slate-800">
                        {formatWeatherValue(w.rain_in_hr, 3, 'in/hr')}
                        <span className="text-slate-500"> · {r.rain_risk}</span>
                      </td>
                      <td className="px-1.5 py-1 text-slate-800">
                        {formatWeatherValue(w.snow_in_hr, 3, 'in/hr')}
                        <span className="text-slate-500"> · {r.snow_risk}</span>
                      </td>
                      <td className="px-1.5 py-1 font-semibold" style={{ color: riskColor(r.overall_risk) }}>
                        {r.overall_risk}
                      </td>
                      <td className="max-w-[180px] px-1.5 py-1 text-slate-600">
                        {r.primary_hazard ?? r.overall_risk_driver ?? '—'}
                      </td>
                    </>
                  ) : (
                    <td colSpan={5} className="px-1.5 py-1 text-slate-600">
                      <span className="font-medium text-slate-800">Forecast unavailable</span>
                      {' — not treated as Low. '}
                      {w?.notes ?? ''}
                    </td>
                  )}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-[10px] leading-snug text-slate-500">
        Risk miles use each road segment&apos;s ending checkpoint. Origin (0 mi) contributes 0 miles.
        {peak?.eta_forecast_note ? ` ${peak.eta_forecast_note}` : ''}
      </p>
    </div>
  )
}
