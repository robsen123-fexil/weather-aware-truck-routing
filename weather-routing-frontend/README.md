# Weather-Aware Truck Routing — Frontend

React + TypeScript + Vite dashboard that talks to the existing Django backend in `../weather-routing-backend`.

## Stack

- React 19 + TypeScript
- Vite
- Tailwind CSS v4
- MapLibre GL JS

## Prerequisites

1. Backend running at `http://127.0.0.1:8000`
2. Node.js 20+

## Setup

```bash
cd weather-routing-frontend
npm install
copy .env.example .env   # Windows
# cp .env.example .env   # macOS / Linux
```

`.env`:

```env
VITE_API_BASE_URL=http://127.0.0.1:8000
```

Do **not** put `OPENROUTESERVICE_API_KEY` in the frontend — it stays in the backend `.env`.

## Run (with backend)

Terminal 1 — backend:

```bash
cd weather-routing-backend
.\.venv\Scripts\Activate.ps1
python manage.py runserver
```

Terminal 2 — frontend:

```bash
cd weather-routing-frontend
npm run dev
```

Open **http://127.0.0.1:5173**

## Build

```bash
npm run build
```

Output directory: `dist`

## Deploy (Vercel)

1. Import the GitHub repo in Vercel.
2. Set **Root Directory** to `weather-routing-frontend`.
3. Framework preset: Vite (Build: `npm run build`, Output: `dist`).
4. Add environment variable (Production + Preview):

```env
VITE_API_BASE_URL=https://your-render-service.onrender.com
```

Use the public Render API URL (no trailing slash). Redeploy after changing env vars so Vite bakes the value into the build.

`vercel.json` rewrites unknown paths to `index.html` for SPA routing.

## Integrated endpoints

| UI action | API |
|-----------|-----|
| Backend status pill | `GET /api/health/` |
| Analyze Routes | `POST /api/routes/analyze/` |
| Route detail (available) | `GET /api/routes/<id>/` |
| Heatmap corridor | `POST /api/weather/forecast/` |

## Features

- Trip form: origin, destination, departure, load weight, 10/25/50 mi intervals
- Up to 3 ranked routes with severe/high miles, average risk, recommendation badge
- MapLibre map: route lines, origin/destination markers, risk-colored checkpoints + popups
- 0–48h forecast slider with risk / wind / rain / snow overlays
- Loading, empty, and error states; CORS via backend `CORS_ALLOWED_ORIGINS`

## Notes

- Ranking comes only from the backend recommendation payload.
- Forecast frames are fetched once per analysis and reused when the slider moves.
- Checkpoint popups show coordinates, distance, ETA, wind/rain/snow, and risk factors from the analyze response.
