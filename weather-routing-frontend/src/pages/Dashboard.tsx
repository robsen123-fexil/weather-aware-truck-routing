import { useEffect, useState } from 'react'
import { checkHealth } from '../api/routes'
import { TripForm } from '../components/TripForm'
import { RouteComparison } from '../components/RouteComparison'
import { RouteMap } from '../components/RouteMap'
import { ForecastSlider } from '../components/ForecastSlider'
import { useRouteAnalysis } from '../hooks/useRouteAnalysis'
import { formatDuration } from '../lib/riskColors'
import { routeNumber } from '../lib/routeStats'
import { shortPlaceLabel } from '../lib/userMessages'
import { overlayColorLabel } from '../lib/corridorForecast'

type Overlay = 'risk' | 'wind' | 'rain' | 'snow'

export function Dashboard() {
  const {
    data,
    selectedRoute,
    selectedRouteId,
    setSelectedRouteId,
    selectRoute,
    forecast,
    forecastHour,
    setForecastHour,
    loading,
    forecastLoading,
    forecastError,
    error,
    analysisGeneration,
    fitGeneration,
    runAnalysis,
  } = useRouteAnalysis()

  const [serviceOnline, setServiceOnline] = useState<boolean | null>(null)
  const [overlay, setOverlay] = useState<Overlay>('risk')

  useEffect(() => {
    let cancelled = false
    checkHealth()
      .then(() => {
        if (!cancelled) setServiceOnline(true)
      })
      .catch(() => {
        if (!cancelled) setServiceOnline(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const showResults = Boolean(data && !loading)
  const recommendedId = data?.recommendation.recommended_route_id ?? null

  return (
    <div className="min-h-screen bg-[radial-gradient(ellipse_at_top,_#e8eef7_0%,_#f1f5f9_45%,_#e2e8f0_100%)]">
      <header className="border-b border-slate-200/80 bg-white/80 backdrop-blur">
        <div className="mx-auto flex max-w-[1440px] flex-wrap items-center justify-between gap-3 px-4 py-4 sm:px-6">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-sky-700">
              Trip planner
            </p>
            <h1 className="text-xl font-bold tracking-tight text-slate-900 sm:text-2xl">
              Weather-Aware Truck Routing
            </h1>
            <p className="mt-0.5 text-sm text-slate-600">
              Compare routes by weather risk, travel time, and forecast coverage.
            </p>
          </div>
          {serviceOnline === false && (
            <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-medium text-amber-900">
              Planning service offline — try again shortly
            </span>
          )}
        </div>
      </header>

      <main className="mx-auto grid max-w-[1440px] gap-4 px-4 py-4 sm:px-6 lg:grid-cols-[minmax(280px,340px)_1fr]">
        <aside className="space-y-4 lg:sticky lg:top-4 lg:self-start">
          <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">
              Plan a trip
            </h2>
            <TripForm loading={loading} onSubmit={runAnalysis} />
            {loading && (
              <div className="mt-4 flex items-center gap-3 rounded-md bg-sky-50 px-3 py-2 text-sm text-sky-900">
                <span className="spinner" aria-hidden />
                Analyzing routes and weather along your corridor…
              </div>
            )}
            {error && (
              <div className="mt-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
                {error}
              </div>
            )}
          </section>
        </aside>

        <section className="flex min-w-0 flex-col gap-4">
          {!showResults && !loading && (
            <div className="rounded-xl border border-dashed border-slate-300 bg-white/70 px-6 py-12 text-center">
              <p className="text-base font-semibold text-slate-800">No trip loaded</p>
              <p className="mx-auto mt-2 max-w-md text-sm text-slate-600">
                Enter an origin, destination, departure time, and load weight to compare up to three route
                alternatives with weather checkpoints and safety recommendations.
              </p>
            </div>
          )}

          {(loading || showResults) && (
            <>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  {loading ? (
                    <p className="text-sm font-medium text-sky-800">Preparing new trip results…</p>
                  ) : selectedRoute && data ? (
                    <p className="text-sm text-slate-700">
                      <span className="font-semibold text-slate-900">
                        Map: Route {routeNumber(selectedRoute)}
                        {recommendedId === selectedRoute.id ? ' (recommended)' : ' (selected for review)'}
                      </span>
                      {' · '}
                      {shortPlaceLabel(data.geocoded.origin.label)}
                      {' → '}
                      {shortPlaceLabel(data.geocoded.destination.label)}
                      {' · '}
                      {selectedRoute.distance_miles.toFixed(1)} mi
                      {' · '}
                      {formatDuration(selectedRoute.duration_minutes)}
                    </p>
                  ) : null}
                </div>
                <div className="flex max-w-md flex-col items-end gap-1">
                  <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                    Map corridor overlay · {overlayColorLabel(overlay)}
                  </span>
                  <div className="flex flex-wrap justify-end gap-1">
                  {(['risk', 'wind', 'rain', 'snow'] as Overlay[]).map((key) => (
                    <button
                      key={key}
                      type="button"
                      onClick={() => setOverlay(key)}
                      className={`rounded-md px-2.5 py-1 text-xs font-medium capitalize ${
                        overlay === key
                          ? 'bg-slate-900 text-white'
                          : 'bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50'
                      }`}
                    >
                      {key}
                    </button>
                  ))}
                  </div>
                </div>
              </div>

              <div className="min-h-[420px] flex-1 lg:min-h-[480px]">
                <RouteMap
                  key={analysisGeneration}
                  routes={showResults ? data!.routes : []}
                  selectedRouteId={showResults ? selectedRouteId : null}
                  recommendedRouteId={showResults ? recommendedId : null}
                  origin={showResults ? data!.geocoded.origin : undefined}
                  destination={showResults ? data!.geocoded.destination : undefined}
                  forecast={showResults ? forecast : null}
                  forecastHour={forecastHour}
                  heatmapOverlay={overlay}
                  loading={loading}
                  fitGeneration={fitGeneration}
                  onSelectRoute={setSelectedRouteId}
                  onSelectRecommended={() => {
                    if (recommendedId) selectRoute(recommendedId, { fit: true })
                  }}
                />
              </div>

              <ForecastSlider
                forecast={showResults ? forecast : null}
                hour={forecastHour}
                onChange={setForecastHour}
                loading={forecastLoading}
                overlay={overlay}
                hasAnalysis={showResults}
                error={showResults ? forecastError : null}
              />

              {showResults && data && (
                <RouteComparison
                  trip={data}
                  selectedRouteId={selectedRouteId}
                  onSelect={(id) => selectRoute(id, { fit: true })}
                />
              )}
            </>
          )}
        </section>
      </main>
    </div>
  )
}
