"""Open-Meteo weather forecast client."""

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

# Keep corridor HTTP volume low on the free Open-Meteo endpoint.
_MAX_CORRIDOR_POINTS = 6
# ~5.5 km cells — short urban trips share one forecast instead of N near-duplicate calls.
_GRID_DEG = 0.05
_BATCH_SIZE = 4
# Process-wide cache so analyze + corridor on the same worker share fetches.
_FORECAST_CACHE: dict[str, dict[str, Any]] = {}
_FORECAST_CACHE_LOCK = threading.Lock()
_FORECAST_CACHE_MAX = 512
# Serialize outbound Open-Meteo calls so free-tier burst limits are not tripped.
_HTTP_LOCK = threading.Lock()
_LAST_HTTP_AT = 0.0
_MIN_HTTP_GAP_S = 0.35


def _grid_coord(value: float) -> float:
    step = _GRID_DEG
    return round(round(float(value) / step) * step, 4)


class WeatherService:
    def __init__(self) -> None:
        self.base_url = getattr(
            settings,
            "OPEN_METEO_BASE_URL",
            "https://api.open-meteo.com/v1",
        ).rstrip("/")
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
        global _LAST_HTTP_AT
        with _HTTP_LOCK:
            now = time.monotonic()
            wait = _MIN_HTTP_GAP_S - (now - _LAST_HTTP_AT)
            if wait > 0:
                time.sleep(wait)
            _LAST_HTTP_AT = time.monotonic()

    def _get_json(self, params: dict[str, Any], *, retries: int = 4) -> dict[str, Any] | list[Any]:
        url = f"{self.base_url}/forecast"
        last_exc: Exception | None = None
        for attempt in range(retries + 1):
            self._throttle()
            try:
                response = requests.get(url, params=params, timeout=self.timeout)
            except requests.RequestException as exc:
                last_exc = exc
                if attempt < retries:
                    time.sleep(0.6 * (attempt + 1))
                    continue
                raise WeatherProviderError(f"Weather request failed: {exc}") from exc

            if response.status_code == 429:
                if attempt < retries:
                    # Free Open-Meteo needs longer cool-downs under burst load.
                    time.sleep(2.5 * (attempt + 1))
                    continue
                raise WeatherProviderError("Weather API rate limit exceeded.", status=429)
            if response.status_code >= 400:
                raise WeatherProviderError(
                    f"Weather API error ({response.status_code}): {response.text[:300]}",
                    status=502,
                )
            return response.json()

        raise WeatherProviderError(f"Weather request failed: {last_exc}")

    def _base_params(self) -> dict[str, Any]:
        return {
            "hourly": "wind_speed_10m,precipitation,rain,snowfall",
            "wind_speed_unit": "mph",
            "precipitation_unit": "inch",
            "timezone": "UTC",
            "forecast_days": 7,
            "past_days": 1,
        }

    def fetch_hourly_forecast(
        self,
        lat: float,
        lon: float,
        *,
        around: datetime | None = None,
        start_day: str | None = None,
        end_day: str | None = None,
    ) -> dict[str, Any]:
        """
        Fetch hourly forecast covering the trip timeline.

        Default path uses a stable forecast_days window so one HTTP call per
        grid cell serves all checkpoint ETAs and corridor hours.
        """
        around = around or datetime.now(timezone.utc)
        if around.tzinfo is None:
            around = around.replace(tzinfo=timezone.utc)

        if start_day is not None and end_day is not None:
            key = self._cache_key(lat, lon, start_day, end_day)
            cached = self._cache_get(key)
            if cached is not None:
                return cached
            # Prefer the shared forecast_days cache to cut request volume.
            return self._fetch_forecast_days(lat, lon)

        return self._fetch_forecast_days(lat, lon)

    def _fetch_forecast_days(self, lat: float, lon: float) -> dict[str, Any]:
        key = self._cache_key(lat, lon, "fd7", "fd7")
        cached = self._cache_get(key)
        if cached is not None:
            return cached

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

    def _fetch_forecast_days_batch(self, cells: list[tuple[float, float]]) -> None:
        """One Open-Meteo request for several grid cells (free-tier friendly)."""
        pending = [
            (lat, lon)
            for lat, lon in cells
            if self._cache_get(self._cache_key(lat, lon, "fd7", "fd7")) is None
        ]
        if not pending:
            return

        lats = ",".join(str(lat) for lat, _ in pending)
        lons = ",".join(str(lon) for _, lon in pending)
        params = {
            **self._base_params(),
            "latitude": lats,
            "longitude": lons,
        }
        data = self._get_json(params)
        payloads: list[dict[str, Any]]
        if isinstance(data, list):
            payloads = [item for item in data if isinstance(item, dict)]
        elif isinstance(data, dict):
            # Single-cell responses are plain objects.
            payloads = [data]
        else:
            payloads = []

        if len(payloads) != len(pending):
            # Fall back to per-cell fetch if the batch shape is unexpected.
            for lat, lon in pending:
                try:
                    self._fetch_forecast_days(lat, lon)
                except WeatherProviderError as exc:
                    logger.warning("Weather cell fetch failed for %s,%s: %s", lat, lon, exc)
            return

        for (lat, lon), payload in zip(pending, payloads):
            self._cache_set(self._cache_key(lat, lon, "fd7", "fd7"), payload)

    def prefetch_locations(self, points: Iterable[tuple[float, float]]) -> None:
        """Warm the forecast cache for unique grid cells before checkpoint scoring."""
        unique: list[tuple[float, float]] = []
        seen: set[tuple[float, float]] = set()
        for lat, lon in points:
            cell = (_grid_coord(lat), _grid_coord(lon))
            if cell in seen:
                continue
            seen.add(cell)
            unique.append(cell)

        if not unique:
            return

        for i in range(0, len(unique), _BATCH_SIZE):
            chunk = unique[i : i + _BATCH_SIZE]
            try:
                self._fetch_forecast_days_batch(chunk)
            except WeatherProviderError as exc:
                logger.warning(
                    "Weather batch prefetch failed (%s); retrying cells one-by-one",
                    exc,
                )
                for lat, lon in chunk:
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
            # Last chance: any nearby cached cell is better than Unavailable.
            nearby = self._nearest_cached_payload(lat, lon)
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

    def _nearest_cached_payload(self, lat: float, lon: float) -> dict[str, Any] | None:
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
            if dist < best_dist and dist <= _GRID_DEG * 2:
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

        Returns hourly frames (0–48h) with weather at each sample point.
        Missing cells are marked available=False rather than failing.
        """
        if hours < 0 or hours > 48:
            raise WeatherProviderError("hours must be between 0 and 48", status=400)
        start = start or datetime.now(timezone.utc)
        if start.tzinfo is None:
            start = start.replace(tzinfo=timezone.utc)

        step = max(1, step_hours)
        points = self._subsample_points(points)

        self.prefetch_locations((float(pt["lat"]), float(pt["lon"])) for pt in points)

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
