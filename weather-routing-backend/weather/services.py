"""Open-Meteo weather forecast client (rate-limit resilient)."""

from __future__ import annotations

import logging
import threading
import time
from datetime import datetime, timedelta, timezone
from typing import Any, Iterable

import requests
from django.conf import settings

from risk.calculator import WeatherMeasurements
from shared.exceptions import WeatherProviderError
from weather.forecast import normalize_open_meteo_hour, weather_to_dict

logger = logging.getLogger(__name__)

# Corridor / heatmap sample budget (analyze already warmed the cache).
_MAX_CORRIDOR_POINTS = 4
# ~22 km cells — nearby checkpoints share one forecast (critical on free Open-Meteo).
_GRID_DEG = 0.2
# Hard cap on unique cells fetched per analyze/corridor call.
_MAX_CELLS_PER_REQUEST = 5
_BATCH_SIZE = 5

_FORECAST_CACHE: dict[str, dict[str, Any]] = {}
_FORECAST_CACHE_LOCK = threading.Lock()
_FORECAST_CACHE_MAX = 768

# Global outbound throttle — free Open-Meteo punishes bursts hard.
_HTTP_LOCK = threading.Lock()
_LAST_HTTP_AT = 0.0
_MIN_HTTP_GAP_S = 0.55
_RATE_LIMIT_COOLDOWN_S = 0.0


def _grid_coord(value: float) -> float:
    step = _GRID_DEG
    return round(round(float(value) / step) * step, 4)


def _subsample_cells(
    cells: list[tuple[float, float]],
    max_cells: int,
) -> list[tuple[float, float]]:
    if len(cells) <= max_cells:
        return cells
    if max_cells <= 1:
        return [cells[len(cells) // 2]]
    out: list[tuple[float, float]] = []
    step = (len(cells) - 1) / (max_cells - 1)
    for i in range(max_cells):
        out.append(cells[round(i * step)])
    # Preserve order / uniqueness
    seen: set[tuple[float, float]] = set()
    unique: list[tuple[float, float]] = []
    for cell in out:
        if cell in seen:
            continue
        seen.add(cell)
        unique.append(cell)
    return unique


class WeatherService:
    def __init__(self) -> None:
        self.base_url = getattr(
            settings,
            "OPEN_METEO_BASE_URL",
            "https://api.open-meteo.com/v1",
        ).rstrip("/")
        self.api_key = (getattr(settings, "OPEN_METEO_API_KEY", "") or "").strip()
        self.timeout = getattr(settings, "HTTP_TIMEOUT_SECONDS", 30)

    def _cache_key(self, lat: float, lon: float, start: str, end: str) -> str:
        return f"{_grid_coord(lat)}:{_grid_coord(lon)}:{start}:{end}"

    def _cache_get(self, key: str) -> dict[str, Any] | None:
        with _FORECAST_CACHE_LOCK:
            hit = _FORECAST_CACHE.get(key)
            return dict(hit) if hit is not None else None

    def _cache_set(self, key: str, data: dict[str, Any]) -> None:
        with _FORECAST_CACHE_LOCK:
            if len(_FORECAST_CACHE) >= _FORECAST_CACHE_MAX:
                _FORECAST_CACHE.pop(next(iter(_FORECAST_CACHE)), None)
            _FORECAST_CACHE[key] = data

    def _throttle(self) -> None:
        global _LAST_HTTP_AT, _RATE_LIMIT_COOLDOWN_S
        with _HTTP_LOCK:
            now = time.monotonic()
            if _RATE_LIMIT_COOLDOWN_S > now:
                time.sleep(_RATE_LIMIT_COOLDOWN_S - now)
                now = time.monotonic()
            wait = _MIN_HTTP_GAP_S - (now - _LAST_HTTP_AT)
            if wait > 0:
                time.sleep(wait)
            _LAST_HTTP_AT = time.monotonic()

    def _mark_rate_limited(self, seconds: float = 8.0) -> None:
        global _RATE_LIMIT_COOLDOWN_S
        with _HTTP_LOCK:
            _RATE_LIMIT_COOLDOWN_S = max(_RATE_LIMIT_COOLDOWN_S, time.monotonic() + seconds)

    def _base_params(self) -> dict[str, Any]:
        params: dict[str, Any] = {
            "hourly": "wind_speed_10m,precipitation,rain,snowfall",
            "wind_speed_unit": "mph",
            "precipitation_unit": "inch",
            "timezone": "UTC",
            "forecast_days": 7,
            "past_days": 1,
        }
        if self.api_key:
            params["apikey"] = self.api_key
        return params

    def _get_json(self, params: dict[str, Any], *, retries: int = 5) -> dict[str, Any] | list[Any]:
        url = f"{self.base_url}/forecast"
        last_exc: Exception | None = None
        for attempt in range(retries + 1):
            self._throttle()
            try:
                response = requests.get(url, params=params, timeout=self.timeout)
            except requests.RequestException as exc:
                last_exc = exc
                if attempt < retries:
                    time.sleep(0.8 * (attempt + 1))
                    continue
                raise WeatherProviderError(f"Weather request failed: {exc}") from exc

            if response.status_code == 429:
                self._mark_rate_limited(3.0 + 1.5 * attempt)
                if attempt < retries:
                    # Keep sleeps short — long cool-downs make Render return 502
                    # for the whole analyze before any forecast is attached.
                    time.sleep(1.5 + 1.25 * attempt)
                    continue
                raise WeatherProviderError("Weather API rate limit exceeded.", status=429)
            if response.status_code >= 400:
                raise WeatherProviderError(
                    f"Weather API error ({response.status_code}): {response.text[:300]}",
                    status=502,
                )
            return response.json()

        raise WeatherProviderError(f"Weather request failed: {last_exc}")

    def fetch_hourly_forecast(
        self,
        lat: float,
        lon: float,
        *,
        around: datetime | None = None,
        start_day: str | None = None,
        end_day: str | None = None,
    ) -> dict[str, Any]:
        around = around or datetime.now(timezone.utc)
        if around.tzinfo is None:
            around = around.replace(tzinfo=timezone.utc)
        # Dated windows collapse to the shared forecast_days cache to cut volume.
        return self._fetch_forecast_days(lat, lon)

    def _fetch_forecast_days(self, lat: float, lon: float) -> dict[str, Any]:
        key = self._cache_key(lat, lon, "fd7", "fd7")
        cached = self._cache_get(key)
        if cached is not None:
            return cached

        # Prefer any nearby warm cell instead of another HTTP call under pressure.
        nearby = self._nearest_cached_payload(lat, lon, max_dist=_GRID_DEG * 1.5)
        if nearby is not None:
            self._cache_set(key, nearby)
            return nearby

        g_lat, g_lon = _grid_coord(lat), _grid_coord(lon)
        params = {
            **self._base_params(),
            "latitude": g_lat,
            "longitude": g_lon,
        }
        data = self._get_json(params)
        if isinstance(data, list):
            data = data[0] if data else {}
        assert isinstance(data, dict)
        self._cache_set(key, data)
        return data

    def _store_batch_payloads(
        self,
        pending: list[tuple[float, float]],
        data: dict[str, Any] | list[Any],
    ) -> bool:
        payloads: list[dict[str, Any]]
        if isinstance(data, list):
            payloads = [item for item in data if isinstance(item, dict)]
        elif isinstance(data, dict):
            payloads = [data]
        else:
            payloads = []

        if len(payloads) != len(pending):
            return False

        for (lat, lon), payload in zip(pending, payloads):
            self._cache_set(self._cache_key(lat, lon, "fd7", "fd7"), payload)
        return True

    def _fetch_forecast_days_batch(self, cells: list[tuple[float, float]]) -> None:
        pending = [
            (lat, lon)
            for lat, lon in cells
            if self._cache_get(self._cache_key(lat, lon, "fd7", "fd7")) is None
        ]
        if not pending:
            return

        params = {
            **self._base_params(),
            "latitude": ",".join(str(lat) for lat, _ in pending),
            "longitude": ",".join(str(lon) for _, lon in pending),
        }
        data = self._get_json(params)
        if self._store_batch_payloads(pending, data):
            return

        # Unexpected shape — one careful sequential pass (still throttled).
        for lat, lon in pending:
            try:
                self._fetch_forecast_days(lat, lon)
            except WeatherProviderError as exc:
                logger.warning("Weather cell fetch failed for %s,%s: %s", lat, lon, exc)

    def prefetch_locations(self, points: Iterable[tuple[float, float]]) -> None:
        """
        Warm the forecast cache for a small set of unique grid cells.

        Caps cell count and never fans out into parallel HTTP — free Open-Meteo
        rate limits are the #1 cause of 0% forecast coverage in production.
        """
        unique: list[tuple[float, float]] = []
        seen: set[tuple[float, float]] = set()
        for lat, lon in points:
            cell = (_grid_coord(lat), _grid_coord(lon))
            if cell in seen:
                continue
            # Skip already-warm cells.
            if self._cache_get(self._cache_key(cell[0], cell[1], "fd7", "fd7")) is not None:
                seen.add(cell)
                continue
            seen.add(cell)
            unique.append(cell)

        if not unique:
            return

        unique = _subsample_cells(unique, _MAX_CELLS_PER_REQUEST)

        for i in range(0, len(unique), _BATCH_SIZE):
            chunk = unique[i : i + _BATCH_SIZE]
            try:
                self._fetch_forecast_days_batch(chunk)
            except WeatherProviderError as exc:
                logger.warning(
                    "Weather batch prefetch failed (%s); brief cooldown then one cell",
                    exc,
                )
                # One recovery cell only — more sequential calls worsen 429s and
                # risk gateway 502s on free Render. Checkpoint scoring reuses
                # nearby cache when exact cells are still cold.
                self._mark_rate_limited(3.0)
                time.sleep(1.5)
                for lat, lon in chunk[:1]:
                    if self._cache_get(self._cache_key(lat, lon, "fd7", "fd7")) is not None:
                        continue
                    try:
                        self._fetch_forecast_days(lat, lon)
                    except WeatherProviderError as cell_exc:
                        logger.warning(
                            "Weather prefetch failed for %s,%s: %s",
                            lat,
                            lon,
                            cell_exc,
                        )

    def weather_at(
        self,
        lat: float,
        lon: float,
        when: datetime,
        *,
        start_day: str | None = None,
        end_day: str | None = None,
    ) -> WeatherMeasurements:
        if when.tzinfo is None:
            when = when.replace(tzinfo=timezone.utc)

        try:
            payload = self.fetch_hourly_forecast(
                lat,
                lon,
                around=when,
                start_day=start_day,
                end_day=end_day,
            )
            return normalize_open_meteo_hour(payload, target_time=when)
        except WeatherProviderError as exc:
            logger.warning("Weather lookup failed for %s,%s: %s", lat, lon, exc.message)
            nearby = self._nearest_cached_payload(lat, lon, max_dist=_GRID_DEG * 4)
            if nearby is not None:
                try:
                    return normalize_open_meteo_hour(nearby, target_time=when)
                except Exception:  # noqa: BLE001
                    pass
            note = (
                "Weather provider rate limit reached for this checkpoint; forecast not retrieved."
                if getattr(exc, "status", None) == 429
                else "Weather forecast unavailable for this checkpoint (provider did not return data)."
            )
            return WeatherMeasurements(
                wind_mph=None,
                rain_in_hr=None,
                snow_in_hr=None,
                available=False,
                notes=note,
            )
        except Exception:  # noqa: BLE001 — keep pipeline alive
            logger.exception("Unexpected weather error for %s,%s", lat, lon)
            return WeatherMeasurements(
                wind_mph=None,
                rain_in_hr=None,
                snow_in_hr=None,
                available=False,
                notes="Weather forecast unavailable for this checkpoint (temporary data issue).",
            )

    def _nearest_cached_payload(
        self,
        lat: float,
        lon: float,
        *,
        max_dist: float,
    ) -> dict[str, Any] | None:
        """Reuse a nearby cached forecast when the exact cell failed (rate limit)."""
        target = (_grid_coord(lat), _grid_coord(lon))
        best: dict[str, Any] | None = None
        best_dist = float("inf")
        with _FORECAST_CACHE_LOCK:
            items = list(_FORECAST_CACHE.items())
        for key, payload in items:
            try:
                parts = key.split(":")
                clat, clon = float(parts[0]), float(parts[1])
            except (ValueError, IndexError):
                continue
            dist = abs(clat - target[0]) + abs(clon - target[1])
            if dist < best_dist and dist <= max_dist:
                best_dist = dist
                best = payload
        return dict(best) if best is not None else None

    def _subsample_points(
        self,
        points: list[dict[str, float]],
        max_points: int = _MAX_CORRIDOR_POINTS,
    ) -> list[dict[str, float]]:
        if len(points) <= max_points:
            return points
        result: list[dict[str, float]] = []
        step = (len(points) - 1) / (max_points - 1)
        for i in range(max_points):
            result.append(points[round(i * step)])
        return result

    def corridor_forecast(
        self,
        points: list[dict[str, float]],
        *,
        start: datetime | None = None,
        hours: int = 48,
        step_hours: int = 1,
    ) -> dict[str, Any]:
        """
        Build a simplified heatmap payload for the trip corridor.

        Prefer cache warmed by analyze. Only fetch a tiny set of missing cells.
        """
        if hours < 0 or hours > 48:
            raise WeatherProviderError("hours must be between 0 and 48", status=400)
        start = start or datetime.now(timezone.utc)
        if start.tzinfo is None:
            start = start.replace(tzinfo=timezone.utc)

        step = max(1, step_hours)
        points = self._subsample_points(points, _MAX_CORRIDOR_POINTS)

        # Soft prefetch — skips warm cells and caps unique HTTP volume.
        try:
            self.prefetch_locations((float(pt["lat"]), float(pt["lon"])) for pt in points)
        except Exception:  # noqa: BLE001
            logger.exception("Corridor weather prefetch failed; using cache/fallbacks")

        frames: list[dict[str, Any]] = []
        for h in range(0, hours + 1, step):
            when = start + timedelta(hours=h)
            samples = []
            for pt in points:
                lat = float(pt["lat"])
                lon = float(pt["lon"])
                wx = self.weather_at(lat, lon, when)
                samples.append(
                    {
                        "lat": lat,
                        "lon": lon,
                        "weather": weather_to_dict(wx),
                    }
                )
            frames.append(
                {
                    "hour_offset": h,
                    "time": when.isoformat(),
                    "samples": samples,
                }
            )

        return {
            "start": start.isoformat(),
            "hours": hours,
            "step_hours": step,
            "note": (
                "Heatmap frames are forecast-hour snapshots along the corridor, "
                "distinct from ETA-matched checkpoint risk used for route ranking."
            ),
            "frames": frames,
        }


def get_weather_service() -> WeatherService:
    return WeatherService()
