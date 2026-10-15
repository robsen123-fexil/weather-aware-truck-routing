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
    <div className="min-w-[220px] max-w-[280px] p-1 text-slate-800 dark:text-slate-100">
      <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
        Checkpoint {checkpoint.index}
        {checkpoint.is_origin ? ' · Origin' : ''}
        {checkpoint.is_destination ? ' · Destination' : ''}
      </p>
      <p className="font-mono text-xs text-slate-600 dark:text-slate-400">
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
          <p className="rounded bg-slate-100 px-2 py-1.5 text-[11px] text-slate-700 dark:bg-slate-950 dark:text-slate-300">
            Forecast unavailable — not evaluated as Low.
            {weather?.notes ? ` ${weather.notes}` : ''}
          </p>
        )}
        <div className="flex items-center justify-between gap-2 border-t border-slate-200 pt-1 dark:border-slate-600">
          <dt className="text-slate-500 dark:text-slate-400">Overall risk</dt>
          <dd className="font-semibold" style={{ color: riskColor(overall) }}>
            {overall}
          </dd>
        </div>
      </dl>
      {risk?.primary_hazard && (
        <p className="mt-2 text-[11px] leading-snug text-slate-500 dark:text-slate-400">{risk.primary_hazard}</p>
      )}
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <dt className="text-slate-500 dark:text-slate-400">{label}</dt>
      <dd className="text-right font-medium text-slate-800 dark:text-slate-100">{value}</dd>
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
    ? `<div class="cp-popup__row"><span class="cp-popup__label">Forecast hour</span><strong>${esc(formatEta(weather.forecast_time))}${
      weather.forecast_delta_minutes != null
        ? ` (Δ ${weather.forecast_delta_minutes} min)`
        : ''
    }</strong></div>`
    : `<div class="cp-popup__row"><span class="cp-popup__label">Forecast hour</span><strong>n/a</strong></div>`

  const body = available
    ? `
        <div class="cp-popup__row"><span class="cp-popup__label">Wind</span><strong>${esc(wind)}</strong></div>
        <div class="cp-popup__row"><span class="cp-popup__label">Rain</span><strong>${esc(rain)}</strong></div>
        <div class="cp-popup__row"><span class="cp-popup__label">Snow</span><strong>${esc(snow)}</strong></div>
      `
    : `<p class="cp-popup__unavailable">Forecast unavailable — not evaluated as Low.${
      weather?.notes ? ` ${esc(weather.notes)}` : ''
    }</p>`

  const hazard = risk?.primary_hazard
    ? `<p class="cp-popup__hazard">${esc(risk.primary_hazard)}</p>`
    : ''

  return `
    <div class="cp-popup">
      <div class="cp-popup__eyebrow">
        Checkpoint ${checkpoint.index}${checkpoint.is_origin ? ' · Origin' : ''}${checkpoint.is_destination ? ' · Destination' : ''}
      </div>
      <div class="cp-popup__coords">
        ${coordinates.lat.toFixed(4)}, ${coordinates.lon.toFixed(4)}
      </div>
      <div class="cp-popup__grid">
        <div class="cp-popup__row"><span class="cp-popup__label">Distance</span><strong>${checkpoint.distance_from_origin_miles.toFixed(1)} mi</strong></div>
        <div class="cp-popup__row"><span class="cp-popup__label">Truck ETA</span><strong>${esc(formatEta(checkpoint.eta))}</strong></div>
        ${forecastRow}
        ${body}
        <div class="cp-popup__row cp-popup__divider">
          <span class="cp-popup__label">Overall risk</span>
          <strong style="color:${color}">${esc(overall)}</strong>
        </div>
      </div>
      ${hazard}
    </div>
  `
}
