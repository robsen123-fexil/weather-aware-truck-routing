import { useEffect, useState, type FormEvent } from 'react'
import { reverseGeocode, type PlaceSuggestion } from '../api/places'
import type { AnalyzeRoutesRequest, CheckpointInterval } from '../types/routing'
import { PlaceAutocomplete } from './PlaceAutocomplete'

interface TripFormProps {
  loading: boolean
  onSubmit: (request: AnalyzeRoutesRequest) => void
}

interface DetectedLocation {
  lat: number
  lon: number
  accuracyM: number | null
  label: string
}

/** Exact current local time for datetime-local (user's timezone). */
function nowLocalInputValue(date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function coordsString(lat: number, lon: number): string {
  return `${lat.toFixed(6)},${lon.toFixed(6)}`
}

const GEO_OPTIONS: PositionOptions = {
  enableHighAccuracy: true,
  timeout: 20_000,
  maximumAge: 0,
}

export function TripForm({ loading, onSubmit }: TripFormProps) {
  const [origin, setOrigin] = useState('')
  const [destination, setDestination] = useState('')
  /** Saved lat/lon from autocomplete (or GPS) so analyze skips Nominatim geocode. */
  const [originCoords, setOriginCoords] = useState<{ lat: number; lon: number } | null>(null)
  const [destinationCoords, setDestinationCoords] = useState<{ lat: number; lon: number } | null>(null)
  const [departureLocal, setDepartureLocal] = useState(() => nowLocalInputValue())
  const [loadWeight, setLoadWeight] = useState(35000)
  const [interval, setIntervalMiles] = useState<CheckpointInterval>(25)
  const [locationStatus, setLocationStatus] = useState<'idle' | 'locating' | 'ok' | 'denied' | 'error'>('idle')
  const [detected, setDetected] = useState<DetectedLocation | null>(null)
  const [usingGpsOrigin, setUsingGpsOrigin] = useState(false)
  const [locationWarning, setLocationWarning] = useState<string | null>(null)
  const [departureLockedToNow, setDepartureLockedToNow] = useState(true)
  const [formError, setFormError] = useState<string | null>(null)

  useEffect(() => {
    if (!departureLockedToNow) return
    const tick = () => setDepartureLocal(nowLocalInputValue())
    tick()
    const id = window.setInterval(tick, 15_000)
    return () => window.clearInterval(id)
  }, [departureLockedToNow])

  const clearDetectedLocation = () => {
    setDetected(null)
    setUsingGpsOrigin(false)
    setLocationWarning(null)
    setLocationStatus('idle')
    setOrigin('')
    setOriginCoords(null)
  }

  const applyPosition = async (pos: GeolocationPosition) => {
    const lat = pos.coords.latitude
    const lon = pos.coords.longitude
    const accuracyM = Number.isFinite(pos.coords.accuracy) ? pos.coords.accuracy : null

    let label = coordsString(lat, lon)
    try {
      const place = await reverseGeocode(lat, lon)
      label = place.label || place.full_label || label
    } catch {
      /* keep coordinate fallback */
    }

    setDetected({ lat, lon, accuracyM, label })
    setUsingGpsOrigin(true)
    setOrigin(label)
    setOriginCoords({ lat, lon })
    setLocationStatus('ok')

    // Browser often returns wrong country via IP/network location (± hundreds of meters+).
    if (accuracyM != null && accuracyM >= 200) {
      setLocationWarning(
        'This looks like a rough network location from your browser/Windows — it is often wrong. '
        + 'If this is not where you are, click “Not my location” and type your real city.',
      )
    } else {
      setLocationWarning(
        'If this place is wrong, your device GPS/Windows Location is reporting another country. '
        + 'Click “Not my location” and type your city instead.',
      )
    }
  }

  const locate = () => {
    if (!navigator.geolocation) {
      setLocationStatus('error')
      setLocationWarning('Geolocation is not available in this browser.')
      return
    }
    setLocationStatus('locating')
    setLocationWarning(null)
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        void applyPosition(pos)
      },
      (err) => {
        setLocationStatus(err.code === err.PERMISSION_DENIED ? 'denied' : 'error')
        setLocationWarning(null)
      },
      GEO_OPTIONS,
    )
  }

  const handleOriginChange = (value: string) => {
    setUsingGpsOrigin(false)
    setDetected(null)
    setLocationWarning(null)
    setLocationStatus('idle')
    setOrigin(value)
    setOriginCoords(null)
  }

  const handleDestinationChange = (value: string) => {
    setDestination(value)
    setDestinationCoords(null)
  }

  const handleOriginSelect = (place: PlaceSuggestion) => {
    setUsingGpsOrigin(false)
    setDetected(null)
    setLocationWarning(null)
    setLocationStatus('idle')
    setOrigin(place.label)
    setOriginCoords({ lat: place.lat, lon: place.lon })
  }

  const handleDestinationSelect = (place: PlaceSuggestion) => {
    setDestination(place.label)
    setDestinationCoords({ lat: place.lat, lon: place.lon })
  }

  const handleSubmit = (e: FormEvent) => {
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

    // Prefer lat,lon so the backend skips Nominatim (avoids 429 after autocomplete).
    let originValue = origin.trim()
    if (originCoords) {
      originValue = coordsString(originCoords.lat, originCoords.lon)
    } else if (usingGpsOrigin && detected) {
      originValue = coordsString(detected.lat, detected.lon)
    }

    let destinationValue = destination.trim()
    if (destinationCoords) {
      destinationValue = coordsString(destinationCoords.lat, destinationCoords.lon)
    }

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
      <div>
        <PlaceAutocomplete
          id="origin"
          label="Origin"
          value={origin}
          onChange={handleOriginChange}
          onSelectPlace={handleOriginSelect}
          required
          disabled={loading}
          placeholder="Type your city (e.g. Riyadh, Cairo, Istanbul)…"
          suppressSuggest={usingGpsOrigin}
        />
        <div className="mt-1.5 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={locate}
            disabled={loading || locationStatus === 'locating'}
            className="rounded border border-slate-300 bg-white px-2 py-1 text-[11px] font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            {locationStatus === 'locating' ? 'Locating…' : 'Use my location'}
          </button>
          {usingGpsOrigin && (
            <button
              type="button"
              onClick={clearDetectedLocation}
              disabled={loading}
              className="rounded border border-amber-300 bg-amber-50 px-2 py-1 text-[11px] font-medium text-amber-900 hover:bg-amber-100 disabled:opacity-50"
            >
              Not my location
            </button>
          )}
          <span className="text-[11px] text-slate-500">
            {locationStatus === 'idle' && 'Tip: typing your city is more reliable than GPS on desktop'}
            {locationStatus === 'ok' && usingGpsOrigin && 'Detected by browser GPS / Windows Location'}
            {locationStatus === 'denied' && 'Location permission denied — type your city instead'}
            {locationStatus === 'error' && 'Could not read GPS — type your city instead'}
            {locationStatus === 'locating' && 'Asking browser for location…'}
          </span>
        </div>
        {locationWarning && (
          <p className="mt-2 rounded-md border border-amber-200 bg-amber-50 px-2.5 py-2 text-[11px] leading-snug text-amber-900">
            {locationWarning}
          </p>
        )}
        {usingGpsOrigin && detected && (
          <p className="mt-1 text-[11px] text-slate-500">
            Using your detected location
            {detected.accuracyM != null ? ` (±${Math.round(detected.accuracyM)} m)` : ''}.
          </p>
        )}
      </div>

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
            className="text-[11px] font-medium text-sky-700 hover:underline disabled:opacity-50"
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
        <p className="mt-1 text-[11px] text-slate-500">
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
                  ? 'border-sky-600 bg-sky-600 text-white'
                  : 'border-slate-300 bg-white text-slate-700 hover:border-slate-400'
              }`}
            >
              {miles} mi
            </button>
          ))}
        </div>
      </div>

      {formError && (
        <p className="rounded-md border border-red-200 bg-red-50 px-2.5 py-2 text-[12px] text-red-800">
          {formError}
        </p>
      )}

      <button
        type="submit"
        disabled={loading || !origin.trim() || !destination.trim()}
        className="w-full rounded-md bg-slate-900 px-4 py-3 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {loading ? 'Analyzing trip…' : 'Compare routes'}
      </button>
    </form>
  )
}
