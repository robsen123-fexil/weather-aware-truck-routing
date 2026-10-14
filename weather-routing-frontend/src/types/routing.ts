/** Types matching the Django weather-routing-backend API responses. */

export type RiskLabel = 'Low' | 'Moderate' | 'High' | 'Severe' | 'No Travel' | 'Unavailable'

export type CheckpointInterval = 10 | 25 | 50

export interface AnalyzeRoutesRequest {
  origin: string
  destination: string
  departure: string
  load_weight_lb: number
  checkpoint_interval_miles: CheckpointInterval
  include_heatmap_points?: boolean
}

export interface GeocodedPlace {
  label: string
  lat: number
  lon: number
  source?: string
  confidence?: number
}

export interface WeatherMeasurements {
  wind_mph: number | null
  rain_in_hr: number | null
  snow_in_hr: number | null
  source: string
  available: boolean
  notes: string
  forecast_time?: string | null
  forecast_delta_minutes?: number | null
}

export interface CheckpointRisk {
  wind_risk: RiskLabel | string
  rain_risk: RiskLabel | string
  snow_risk: RiskLabel | string
  overall_risk: RiskLabel | string
  overall_risk_score: number | null
  overall_risk_driver?: string
  load_adjusted: boolean
  evaluated?: boolean
  factors: string[]
  primary_hazard?: string | null
}

export interface RouteWeatherSummary {
  checkpoints_total: number
  checkpoints_evaluated: number
  checkpoints_unavailable: number
  peak_wind_mph: number | null
  peak_rain_in_hr: number | null
  peak_snow_in_hr: number | null
  checkpoint_weather: Array<Record<string, unknown>>
  eta_forecast_note?: string
}

export interface Checkpoint {
  index: number
  coordinates: { lat: number; lon: number }
  distance_from_origin_m: number
  distance_from_origin_miles: number
  is_origin?: boolean
  is_destination?: boolean
  eta: string
  eta_offset_seconds?: number
  progress_fraction?: number
  weather: WeatherMeasurements
  risk: CheckpointRisk
}

export interface NoTravelSegment {
  from_miles: number
  to_miles: number
  miles: number
  checkpoint_index: number
  coordinates?: { lat: number; lon: number }
  eta?: string
}

export interface ForecastCoverage {
  checkpoints_total: number
  checkpoints_with_forecast: number
  checkpoints_without_forecast: number
  coverage_percent: number
}

export interface RiskSummary {
  severe_miles: number
  high_miles: number
  moderate_miles: number
  low_miles: number
  no_travel_miles: number
  unavailable_miles?: number
  total_risk_miles: number
  evaluated_miles?: number
  average_risk: number
  highest_risk?: string
  has_no_travel: boolean
  has_incomplete_forecast?: boolean
  no_travel_segments: NoTravelSegment[]
  risk_mile_breakdown: Record<string, number>
  forecast_coverage?: ForecastCoverage
}

export interface RouteGeometry {
  type: 'LineString'
  coordinates: [number, number][] // [lon, lat]
}

export interface AnalyzedRoute {
  id: string
  provider?: string
  profile?: string
  alternative_index?: number
  rank?: number
  geometry: RouteGeometry
  distance_m: number
  distance_miles: number
  duration_seconds: number
  duration_minutes: number
  checkpoints: Checkpoint[]
  risk_summary: RiskSummary
  weather_summary?: RouteWeatherSummary
  warnings: string[]
}

export interface RecommendationComparison {
  route_id: string
  rank: number
  severe_miles: number
  high_miles: number
  average_risk: number
  duration_seconds: number
  has_no_travel: boolean
}

export interface Recommendation {
  recommended_route_id: string | null
  safe_recommendation_available: boolean
  confidence?: 'high' | 'partial' | 'low' | 'none'
  reason: string
  ranking_criteria: string[]
  comparisons: RecommendationComparison[]
}

export interface AnalyzeRoutesResponse {
  request: {
    origin: string
    destination: string
    departure: string
    load_weight_lb: number
    checkpoint_interval_miles: number
  }
  geocoded: {
    origin: GeocodedPlace
    destination: GeocodedPlace
  }
  routes: AnalyzedRoute[]
  recommendation: Recommendation
  warnings: string[]
  assumptions: Record<string, string>
  heatmap_seed_points?: { lat: number; lon: number }[]
}

export interface HealthResponse {
  status: string
  service: string
  version: string
}

export interface ForecastSample {
  lat: number
  lon: number
  weather: WeatherMeasurements
}

export interface ForecastFrame {
  hour_offset: number
  time: string
  samples: ForecastSample[]
}

export interface CorridorForecastResponse {
  start: string
  hours: number
  step_hours: number
  note?: string
  frames: ForecastFrame[]
}

export interface ApiErrorBody {
  error?: {
    code?: string
    message?: string
    details?: unknown
  }
}
