import type { Checkpoint } from '../types/routing'
import { formatEta, riskColor } from '../lib/riskColors'
import { formatWeatherValue } from '../lib/routeStats'

interface CheckpointPopupProps {
  checkpoint: Checkpoint
}

export function CheckpointPopupContent({ checkpoint }: CheckpointPopupProps) {
  const { weather, risk, coordinates } = checkpoint
  const available = weather?.available
  const overall = risk?.overall_risk ?? (available ? 'Low' : 'Unavailable')

  return (
    <div className="min-w-[220px] max-w-[280px] p-1 text-slate-800">
      <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
        Checkpoint {checkpoint.index}
        {checkpoint.is_origin ? ' · Origin' : ''}
        {checkpoint.is_destination ? ' · Destination' : ''}
      </p>
      <p className="font-mono text-xs text-slate-600">
        {coordinates.lat.toFixed(4)}, {coordinates.lon.toFixed(4)}
      </p>
      <dl className="mt-2 space-y-1 text-xs">
        <Row label="Distance" value={`${checkpoint.distance_from_origin_miles.toFixed(1)} mi`} />
        <Row label="Truck ETA" value={formatEta(checkpoint.eta)} />
        <Row
          label="Forecast hour"
          value={
            weather?.forecast_time
              ? `${formatEta(weather.forecast_time)}${
                weather.forecast_delta_minutes != null
                  ? ` (Δ ${weather.forecast_delta_minutes} min)`
                  : ''
              }`
              : 'n/a'
          }
        />
        {available ? (
          <>
            <Row
              label="Wind"
              value={`${formatWeatherValue(weather.wind_mph, 1, 'mph')} (${risk.wind_risk})`}
            />
            <Row
              label="Rain"
              value={`${formatWeatherValue(weather.rain_in_hr, 3, 'in/hr')} (${risk.rain_risk})`}
            />
            <Row
              label="Snow"
              value={`${formatWeatherValue(weather.snow_in_hr, 3, 'in/hr')} (${risk.snow_risk})`}
            />
          </>
        ) : (
          <p className="rounded bg-slate-100 px-2 py-1.5 text-[11px] text-slate-700">
            Forecast unavailable — not evaluated as Low.
            {weather?.notes ? ` ${weather.notes}` : ''}
          </p>
        )}
        <div className="flex items-center justify-between gap-2 border-t border-slate-200 pt-1">
          <dt className="text-slate-500">Overall risk</dt>
          <dd className="font-semibold" style={{ color: riskColor(overall) }}>
            {overall}
          </dd>
        </div>
      </dl>
      {risk?.primary_hazard && (
        <p className="mt-2 text-[11px] leading-snug text-slate-500">{risk.primary_hazard}</p>
      )}
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <dt className="text-slate-500">{label}</dt>
      <dd className="text-right font-medium text-slate-800">{value}</dd>
    </div>
  )
}

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** HTML string for MapLibre Popup (no React root required). */
export function checkpointPopupHtml(checkpoint: Checkpoint): string {
  const { weather, risk, coordinates } = checkpoint
  const available = weather?.available
  const overall = risk?.overall_risk ?? (available ? 'Low' : 'Unavailable')
  const color = riskColor(overall)

  const wind = available
    ? `${formatWeatherValue(weather.wind_mph, 1, 'mph')} (${risk.wind_risk})`
    : 'n/a'
  const rain = available
    ? `${formatWeatherValue(weather.rain_in_hr, 3, 'in/hr')} (${risk.rain_risk})`
    : 'n/a'
  const snow = available
    ? `${formatWeatherValue(weather.snow_in_hr, 3, 'in/hr')} (${risk.snow_risk})`
    : 'n/a'

  const forecastRow = weather?.forecast_time
    ? `<div style="display:flex;justify-content:space-between;gap:12px"><span style="color:#64748b">Forecast hour</span><strong>${esc(formatEta(weather.forecast_time))}${
      weather.forecast_delta_minutes != null
        ? ` (Δ ${weather.forecast_delta_minutes} min)`
        : ''
    }</strong></div>`
    : `<div style="display:flex;justify-content:space-between;gap:12px"><span style="color:#64748b">Forecast hour</span><strong>n/a</strong></div>`

  const body = available
    ? `
        <div style="display:flex;justify-content:space-between;gap:12px"><span style="color:#64748b">Wind</span><strong>${esc(wind)}</strong></div>
        <div style="display:flex;justify-content:space-between;gap:12px"><span style="color:#64748b">Rain</span><strong>${esc(rain)}</strong></div>
        <div style="display:flex;justify-content:space-between;gap:12px"><span style="color:#64748b">Snow</span><strong>${esc(snow)}</strong></div>
      `
    : `<p style="margin:0;padding:6px 8px;background:#f1f5f9;border-radius:6px;font-size:11px;color:#334155">Forecast unavailable — not evaluated as Low.${
      weather?.notes ? ` ${esc(weather.notes)}` : ''
    }</p>`

  const hazard = risk?.primary_hazard
    ? `<p style="margin:8px 0 0;font-size:11px;color:#64748b;line-height:1.35">${esc(risk.primary_hazard)}</p>`
    : ''

  return `
    <div style="font-family:IBM Plex Sans,sans-serif;min-width:220px;max-width:280px;color:#1e293b">
      <div style="font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.04em;color:#64748b;margin-bottom:4px">
        Checkpoint ${checkpoint.index}${checkpoint.is_origin ? ' · Origin' : ''}${checkpoint.is_destination ? ' · Destination' : ''}
      </div>
      <div style="font-family:IBM Plex Mono,monospace;font-size:11px;color:#475569">
        ${coordinates.lat.toFixed(4)}, ${coordinates.lon.toFixed(4)}
      </div>
      <div style="margin-top:8px;font-size:12px;display:grid;gap:4px">
        <div style="display:flex;justify-content:space-between;gap:12px"><span style="color:#64748b">Distance</span><strong>${checkpoint.distance_from_origin_miles.toFixed(1)} mi</strong></div>
        <div style="display:flex;justify-content:space-between;gap:12px"><span style="color:#64748b">Truck ETA</span><strong>${esc(formatEta(checkpoint.eta))}</strong></div>
        ${forecastRow}
        ${body}
        <div style="display:flex;justify-content:space-between;gap:12px;border-top:1px solid #e2e8f0;padding-top:4px">
          <span style="color:#64748b">Overall risk</span>
          <strong style="color:${color}">${esc(overall)}</strong>
        </div>
      </div>
      ${hazard}
    </div>
  `
}
