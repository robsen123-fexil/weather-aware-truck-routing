# Weather-Aware Truck Routing

Plan truck trips with real road routes, ETA-matched weather forecasts, and risk scoring so you can compare alternatives and pick the safer option.

## What’s included

| Folder | Stack |
|--------|--------|
| `weather-routing-backend/` | Django REST API — geocoding, routing, weather, risk, recommendations |
| `weather-routing-frontend/` | React + TypeScript + MapLibre — trip planner dashboard |

## Features

- Up to three road-following route alternatives (OpenRouteService / OSRM)
- Checkpoint weather (wind, rain, snow) matched to truck ETA
- Load-aware risk levels and risk-mile summaries
- Interactive map with recommended vs alternative routes
- 0–48 hour corridor forecast timeline

## Quick start

### Backend

```bash
cd weather-routing-backend
python -m venv .venv
# Windows
.\.venv\Scripts\Activate.ps1
# macOS / Linux
# source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env   # or: copy .env.example .env
# Set OPENROUTESERVICE_API_KEY in .env
python manage.py migrate
python manage.py runserver
```

- API: http://127.0.0.1:8000  
- OpenAPI docs: http://127.0.0.1:8000/docs/

### Frontend

```bash
cd weather-routing-frontend
npm install
cp .env.example .env   # or: copy .env.example .env
npm run dev
```

- UI: http://localhost:5173

## Environment

| Variable | Where | Purpose |
|----------|-------|---------|
| `OPENROUTESERVICE_API_KEY` | backend `.env` | Routing / geocoding (required for ORS) |
| `VITE_API_BASE_URL` | frontend `.env` | Defaults to `http://127.0.0.1:8000` |
| `CORS_ALLOWED_ORIGINS` | backend `.env` | Include `http://localhost:5173` |

Do not commit `.env` files. Use `.env.example` as a template.
