import { useEffect, useState, type FormEvent } from 'react'
import { suggestPlaces, type PlaceSuggestion } from '../api/places'
import type { AnalyzeRoutesRequest, CheckpointInterval } from '../types/routing'
import { PlaceAutocomplete } from './PlaceAutocomplete'

interface TripFormProps {
  loading: boolean
  onSubmit: (request: AnalyzeRoutesRequest) => void
}

/** Exact current local time for datetime-local (user's timezone). */
function nowLocalInputValue(date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function coordsString(lat: number, lon: number): string {
  return `${lat.toFixed(6)},${lon.toFixed(6)}`
}

export function TripForm({ loading, onSubmit }: TripFormProps) {
  const [origin, setOrigin] = useState('')
  const [destination, setDestination] = useState('')
  /** Saved lat/lon from autocomplete so analyze skips Nominatim geocode. */
  const [originCoords, setOriginCoords] = useState<{ lat: number; lon: number } | null>(null)
  const [destinationCoords, setDestinationCoords] = useState<{ lat: number; lon: number } | null>(null)
  const [departureLocal, setDepartureLocal] = useState(() => nowLocalInputValue())
  const [loadWeight, setLoadWeight] = useState(35000)
  const [interval, setIntervalMiles] = useState<CheckpointInterval>(25)
  const [departureLockedToNow, setDepartureLockedToNow] = useState(true)
  const [formError, setFormError] = useState<string | null>(null)

  useEffect(() => {
    if (!departureLockedToNow) return
    const tick = () => setDepartureLocal(nowLocalInputValue())
    tick()
    const id = window.setInterval(tick, 15_000)
    return () => window.clearInterval(id)
  }, [departureLockedToNow])

  const handleOriginChange = (value: string) => {
    setOrigin(value)
    setOriginCoords(null)
  }

  const handleDestinationChange = (value: string) => {
    setDestination(value)
    setDestinationCoords(null)
  }

  const handleOriginSelect = (place: PlaceSuggestion) => {
    setOrigin(place.label)
    setOriginCoords({ lat: place.lat, lon: place.lon })
  }

  const handleDestinationSelect = (place: PlaceSuggestion) => {
    setDestination(place.label)
    setDestinationCoords({ lat: place.lat, lon: place.lon })
  }

  const resolvePlaceCoords = async (
    text: string,
    existing: { lat: number; lon: number } | null,
  ): Promise<{ lat: number; lon: number } | null> => {
    if (existing) return existing
    const trimmed = text.trim()
    if (!trimmed) return null
    if (/^-?\d+(\.\d+)?\s*,\s*-?\d+(\.\d+)?$/.test(trimmed)) {
      const [a, b] = trimmed.split(',').map((p) => Number(p.trim()))
      if (Number.isFinite(a) && Number.isFinite(b)) return { lat: a!, lon: b! }
    }
    try {
      const res = await suggestPlaces(trimmed, 1)
      const hit = res.suggestions[0]
      if (hit && Number.isFinite(hit.lat) && Number.isFinite(hit.lon)) {
        return { lat: hit.lat, lon: hit.lon }
      }
    } catch {
      /* analyze will still attempt server-side geocode */
    }
    return null
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (loading) return
    setFormError(null)

    if (!origin.trim() || !destination.trim()) {
      setFormError('Enter both an origin and a destination.')
      return
    }

    const weight = Number(loadWeight)
    if (!Number.isFinite(weight) || weight < 0) {
      setFormError('Load weight must be a number of 0 lb or greater.')
      return
    }

    const departureValue = departureLockedToNow ? nowLocalInputValue() : departureLocal
    if (departureLockedToNow) setDepartureLocal(departureValue)

    const departure = new Date(departureValue)
    if (Number.isNaN(departure.getTime())) {
      setFormError('Enter a valid departure date and time.')
      return
    }

    // Prefer lat,lon so the backend skips geocode (faster + avoids rate limits).
    const [resolvedOrigin, resolvedDest] = await Promise.all([
      resolvePlaceCoords(origin, originCoords),
      resolvePlaceCoords(destination, destinationCoords),
    ])
    if (resolvedOrigin) setOriginCoords(resolvedOrigin)
    if (resolvedDest) setDestinationCoords(resolvedDest)

    const originValue = resolvedOrigin
      ? coordsString(resolvedOrigin.lat, resolvedOrigin.lon)
      : origin.trim()
    const destinationValue = resolvedDest
      ? coordsString(resolvedDest.lat, resolvedDest.lon)
      : destination.trim()

    onSubmit({
      origin: originValue,
      destination: destinationValue,
      departure: departure.toISOString(),
      load_weight_lb: weight,
      checkpoint_interval_miles: interval,
      include_heatmap_points: true,
    })
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <PlaceAutocomplete
        id="origin"
        label="Origin"
        value={origin}
        onChange={handleOriginChange}
        onSelectPlace={handleOriginSelect}
        required
        disabled={loading}
        placeholder="Type your city (e.g. Riyadh, Cairo, Istanbul)…"
      />

      <PlaceAutocomplete
        id="destination"
        label="Destination"
        onSelectPlace={handleDestinationSelect}
        value={destination}
        onChange={handleDestinationChange}
        required
        disabled={loading}
        placeholder="Type destination city…"
      />

      <div>
        <div className="mb-1 flex items-center justify-between gap-2">
          <label className="field-label !mb-0" htmlFor="departure">Departure</label>
          <button
            type="button"
            onClick={() => {
              setDepartureLockedToNow(true)
              setDepartureLocal(nowLocalInputValue())
            }}
            disabled={loading}
            className="text-[11px] font-medium text-sky-700 hover:underline disabled:opacity-50 dark:text-sky-400"
          >
            Use exact now
          </button>
        </div>
        <input
          id="departure"
          type="datetime-local"
          className="field-input"
          value={departureLocal}
          onChange={(e) => {
            setDepartureLockedToNow(false)
            setDepartureLocal(e.target.value)
          }}
          required
          disabled={loading}
        />
        <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
          {departureLockedToNow
            ? `Live local time (${Intl.DateTimeFormat().resolvedOptions().timeZone})`
            : 'Custom departure (manual)'}
        </p>
      </div>

      <div>
        <label className="field-label" htmlFor="load">Load weight (lb)</label>
        <input
          id="load"
          type="number"
          min={0}
          step={100}
          className="field-input"
          value={loadWeight}
          onChange={(e) => setLoadWeight(Number(e.target.value))}
          required
          disabled={loading}
        />
      </div>

      <div>
        <span className="field-label">Checkpoint interval</span>
        <div className="mt-1.5 flex gap-2">
          {([10, 25, 50] as CheckpointInterval[]).map((miles) => (
            <button
              key={miles}
              type="button"
              disabled={loading}
              onClick={() => setIntervalMiles(miles)}
              className={`flex-1 rounded-md border px-2 py-2 text-sm font-medium transition ${
                interval === miles
                  ? 'border-sky-600 bg-sky-600 text-white dark:border-sky-500 dark:bg-sky-500 dark:text-slate-950'
                  : 'border-slate-300 bg-white text-slate-700 hover:border-slate-400 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 dark:hover:border-slate-500'
              }`}
            >
              {miles} mi
            </button>
          ))}
        </div>
      </div>

      {formError && (
        <p className="rounded-md border border-red-200 bg-red-50 px-2.5 py-2 text-[12px] text-red-800 dark:border-red-800 dark:bg-red-950/40 dark:text-red-200">
          {formError}
        </p>
      )}

      <button
        type="submit"
        disabled={loading || !origin.trim() || !destination.trim()}
        className="w-full rounded-md bg-slate-900 px-4 py-3 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-sky-500 dark:text-slate-950 dark:hover:bg-sky-400"
      >
        {loading ? 'Analyzing trip…' : 'Compare routes'}
      </button>
    </form>
  )
}
