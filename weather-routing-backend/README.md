# Weather-Aware Truck Routing — Backend

Django + Django REST Framework API that analyzes truck routes for weather risk, load weight, and travel time, then recommends the safest option.

## Features

- Geocode origin/destination and fetch up to **3 route alternatives** (OpenRouteService)
- Sample **checkpoints** every **10 / 25 / 50** miles with ETAs from departure time
- Fetch forecast weather (Open-Meteo) at each checkpoint ETA
- Apply **wind / rain / snow / load** risk rules
- Rank routes by severe miles → high miles → average risk → duration
- Exclude routes with **No Travel** segments from safe recommendation
- Heatmap-oriented **0–48 hour** forecast endpoint

## Stack

- Python 3.12+
- Django + Django REST Framework
- django-cors-headers
- OpenRouteService (routing + geocoding)
- Open-Meteo (weather; no API key)

## Project layout

```
weather-routing-backend/
  config/             # Django settings & URLs
  routing/            # Geocoding, directions, checkpoints, ETA
  weather/            # Forecast client & normalization
  risk/               # Thresholds, checkpoint risk, route metrics
  recommendations/    # Ranking & explanation
  planner/            # Orchestration + REST endpoints
  shared/             # Constants & exceptions
```

## Setup

```bash
cd weather-routing-backend
python -m venv .venv

# Windows
.\.venv\Scripts\Activate.ps1

# macOS / Linux
source .venv/bin/activate

pip install -r requirements.txt
copy .env.example .env   # or: cp .env.example .env
```

Edit `.env` and set:

```env
OPENROUTESERVICE_API_KEY=your_key_here
```

Get a free key at [OpenRouteService](https://openrouteservice.org/dev/#/signup).

Run:

```bash
python manage.py migrate
python manage.py runserver
```

API base: `http://127.0.0.1:8000/api/`

## Interactive docs

With the server running, open:

- **Swagger UI:** http://127.0.0.1:8000/docs/
- **ReDoc:** http://127.0.0.1:8000/redoc/
- **OpenAPI schema:** http://127.0.0.1:8000/api/schema/

## Tests

```bash
python manage.py test risk routing
```

## Endpoints

### `GET /api/health/`

```json
{ "status": "ok", "service": "weather-aware-truck-routing", "version": "1.0.0" }
```

### `POST /api/routes/analyze/`

**Request**

```json
{
  "origin": "Chicago, IL",
  "destination": "Detroit, MI",
  "departure": "2026-06-15T08:00:00Z",
  "load_weight_lb": 35000,
  "checkpoint_interval_miles": 25,
  "include_heatmap_points": true
}
```

`origin` / `destination` may also be `"lat,lon"` (e.g. `"41.88,-87.63"`).

**Response (shape)**

```json
{
  "request": { "...": "..." },
  "geocoded": { "origin": {}, "destination": {} },
  "routes": [
    {
      "id": "ors-driving-hgv-...",
      "rank": 1,
      "geometry": { "type": "LineString", "coordinates": [[lon, lat], "..."] },
      "distance_miles": 280.5,
      "duration_minutes": 310.2,
      "checkpoints": [
        {
          "index": 0,
          "coordinates": { "lat": 41.88, "lon": -87.63 },
          "distance_from_origin_miles": 0,
          "eta": "2026-06-15T08:00:00+00:00",
          "weather": {
            "wind_mph": 12.1,
            "rain_in_hr": 0.0,
            "snow_in_hr": 0.0,
            "available": true
          },
          "risk": {
            "wind_risk": "Low",
            "rain_risk": "Low",
            "snow_risk": "Low",
            "overall_risk": "Low",
            "overall_risk_score": 0
          }
        }
      ],
      "risk_summary": {
        "severe_miles": 0,
        "high_miles": 12.5,
        "average_risk": 0.4,
        "has_no_travel": false,
        "no_travel_segments": [],
        "risk_mile_breakdown": {}
      },
      "warnings": []
    }
  ],
  "recommendation": {
    "recommended_route_id": "ors-...",
    "safe_recommendation_available": true,
    "reason": "...",
    "ranking_criteria": [
      "fewest_severe_miles",
      "fewest_high_miles",
      "lowest_average_risk",
      "shortest_duration"
    ],
    "comparisons": []
  },
  "warnings": [],
  "assumptions": {}
}
```

### `GET /api/routes/<route_id>/`

Returns a route previously returned by `analyze` (in-memory cache for the running process).

### `GET /api/weather/forecast/?lat=41.88&lon=-87.63&hours=48&step_hours=1`

Or `POST` with corridor points:

```json
{
  "points": [
    { "lat": 41.88, "lon": -87.63 },
    { "lat": 42.1, "lon": -86.5 }
  ],
  "hours": 48,
  "step_hours": 3
}
```

## Risk rules (assessment)

| Condition | Low | Moderate | High | Severe | No Travel |
|-----------|-----|----------|------|--------|-----------|
| Wind (mph) | <25 | 25–34 | 35–44 | 45–54 | ≥55 |
| Rain (in/hr) | <0.10 | 0.10–<0.25 | 0.25–<0.50 | 0.50–1.00 | >1.00 |
| Snow (in/hr) | <0.5 | 0.5–<1.0 | 1.0–<2.0 | 2.0–3.0 | >3.0 |

**Load adjustments**

- Wind ≥55 mph → No Travel (any load)
- Wind 45–54 mph + load >30,000 lb → No Travel
- Wind 35–44 mph + load >40,000 lb → Severe

**Overall checkpoint risk** = max(load-adjusted wind, rain, snow).

## Documented assumptions

1. **Risk miles** — Segment between consecutive checkpoints inherits the overall risk of the *ending* checkpoint. Length = Δ distance-from-origin. Destination included; origin adds 0 miles.
2. **ETA** — Linear in distance using provider `duration / distance`.
3. **No Travel** — Any No Travel checkpoint/segment disqualifies a route from safe recommendation (still returned and ranked after safe routes).
4. **Alternatives** — If the provider returns fewer than 3 routes, available routes are returned with a warning.

## CORS

Configured via `CORS_ALLOWED_ORIGINS` for the React frontend (defaults include `http://localhost:3000` and `http://localhost:5173`).

## Frontend

The React app lives in `../weather-routing-frontend`.

```bash
cd ../weather-routing-frontend
npm install
npm run dev
```

Open http://127.0.0.1:5173 — see that project's README for full UI docs.
