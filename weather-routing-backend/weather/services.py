"""Open-Meteo weather forecast client."""

from __future__ import annotations

import logging
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timedelta, timezone
from typing import Any, Iterable

import requests
from django.conf import settings

from risk.calculator import WeatherMeasurements
from shared.exceptions import WeatherProviderError
from weather.forecast import normalize_open_meteo_hour, weather_to_dict

logger = logging.getLogger(__name__)

# Keep corridor HTTP volume low on the free Open-Meteo endpoint.
_MAX_CORRIDOR_POINTS = 8
_PREFETCH_WORKERS = 6

# Process-wide cache so analyze + corridor on the same worker share fetches.
_FORECAST_CACHE: dict[str, dict[str, Any]] = {}
_FORECAST_CACHE_LOCK = threading.Lock()
_FORECAST_CACHE_MAX = 256


class WeatherService:
    def __init__(self) -> None:
        self.base_url = getattr(
            settings,
            "OPEN_METEO_BASE_URL",
            "https://api.open-meteo.com/v1",
        ).rstrip("/")
        self.timeout = getattr(settings, "HTTP_TIMEOUT_SECONDS", 30)

    def _cache_key(self, lat: float, lon: float, start: str, end: str) -> str:
        return f"{round(lat, 3)}:{round(lon, 3)}:{start}:{end}"

    def _cache_get(self, key: str) -> dict[str, Any] | None:
        with _FORECAST_CACHE_LOCK:
            hit = _FORECAST_CACHE.get(key)
            return dict(hit) if hit is not None else None

    def _cache_set(self, key: str, data: dict[str, Any]) -> None:
        with _FORECAST_CACHE_LOCK:
            if len(_FORECAST_CACHE) >= _FORECAST_CACHE_MAX:
                # Drop an arbitrary old entry (FIFO-ish via insert order on 3.7+).
                _FORECAST_CACHE.pop(next(iter(_FORECAST_CACHE)), None)
            _FORECAST_CACHE[key] = data

    def _get_json(self, params: dict[str, Any], *, retries: int = 2) -> dict[str, Any] | list[Any]:
        url = f"{self.base_url}/forecast"
        last_exc: Exception | None = None
        for attempt in range(retries + 1):
            try:
                response = requests.get(url, params=params, timeout=self.timeout)
            except requests.RequestException as exc:
                last_exc = exc
                if attempt < retries:
                    time.sleep(0.4 * (attempt + 1))
                    continue
                raise WeatherProviderError(f"Weather request failed: {exc}") from exc

            if response.status_code == 429:
                if attempt < retries:
                    time.sleep(1.5 * (attempt + 1))
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
        """
        Fetch hourly forecast covering the trip timeline.

        Default path uses a stable forecast_days window so one HTTP call per
        location serves all checkpoint ETAs and corridor hours (critical on
        free Open-Meteo rate limits). Explicit start_day/end_day still supported.
        """
        around = around or datetime.now(timezone.utc)
        if around.tzinfo is None:
            around = around.replace(tzinfo=timezone.utc)

        # Dated windows are optional; default stable forecast_days cache is preferred
        # so analyze + corridor share one HTTP call per location.
        if start_day is not None and end_day is not None:
            key = self._cache_key(lat, lon, start_day, end_day)
            cached = self._cache_get(key)
            if cached is not None:
                return cached
            params = {
                "latitude": lat,
                "longitude": lon,
                "hourly": "wind_speed_10m,precipitation,rain,snowfall",
                "wind_speed_unit": "mph",
                "precipitation_unit": "inch",
                "timezone": "UTC",
                "start_date": start_day,
                "end_date": end_day,
            }
            try:
                data = self._get_json(params)
            except WeatherProviderError as exc:
                if getattr(exc, "status", None) == 429:
                    raise
                logger.warning("Dated forecast failed (%s); falling back to forecast_days", exc)
                return self._fetch_forecast_days(lat, lon)
            if isinstance(data, list):
                data = data[0] if data else {}
            assert isinstance(data, dict)
            self._cache_set(key, data)
            return data

        return self._fetch_forecast_days(lat, lon)

    def _fetch_forecast_days(self, lat: float, lon: float) -> dict[str, Any]:
        key = self._cache_key(lat, lon, "fd7", "fd7")
        cached = self._cache_get(key)
        if cached is not None:
            return cached
        params = {
            "latitude": lat,
            "longitude": lon,
            "hourly": "wind_speed_10m,precipitation,rain,snowfall",
            "wind_speed_unit": "mph",
            "precipitation_unit": "inch",
            "timezone": "UTC",
            "forecast_days": 7,
            "past_days": 1,
        }
        data = self._get_json(params)
        if isinstance(data, list):
            data = data[0] if data else {}
        assert isinstance(data, dict)
        self._cache_set(key, data)
        return data

    def prefetch_locations(self, points: Iterable[tuple[float, float]]) -> None:
        """Warm the forecast cache for unique ~1km cells before checkpoint scoring."""
        unique: list[tuple[float, float]] = []
        seen: set[tuple[float, float]] = set()
        for lat, lon in points:
            key = (round(float(lat), 3), round(float(lon), 3))
            if key in seen:
                continue
            seen.add(key)
            unique.append(key)

        if not unique:
            return

        def _warm(cell: tuple[float, float]) -> None:
            lat, lon = cell
            cache_key = self._cache_key(lat, lon, "fd7", "fd7")
            if self._cache_get(cache_key) is not None:
                return
            try:
                self._fetch_forecast_days(lat, lon)
            except Exception:  # noqa: BLE001 — keep analyze moving
                logger.warning("Weather prefetch failed for %s,%s", lat, lon)

        workers = min(_PREFETCH_WORKERS, len(unique))
        with ThreadPoolExecutor(max_workers=workers) as pool:
            futures = [pool.submit(_warm, cell) for cell in unique]
            for fut in as_completed(futures):
                try:
                    fut.result()
                except Exception:  # noqa: BLE001
                    logger.exception("Unexpected weather prefetch error")

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
            # Log full technical detail server-side; never surface raw provider/network
            # error text to the UI (see config/exception_handler.py for the same pattern).
            logger.warning("Weather lookup failed for %s,%s: %s", lat, lon, exc.message)
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
        This timeline is independent of per-checkpoint ETA risk analysis.

        One Open-Meteo fetch per unique point covers the full window; frames
        are sliced from that cache (avoids free-tier rate limits + worker timeouts).
        """
        if hours < 0 or hours > 48:
            raise WeatherProviderError("hours must be between 0 and 48", status=400)
        start = start or datetime.now(timezone.utc)
        if start.tzinfo is None:
            start = start.replace(tzinfo=timezone.utc)

        step = max(1, step_hours)
        points = self._subsample_points(points)

        # Prefetch once per point via stable forecast_days cache (no dated window).
        for pt in points:
            lat = float(pt["lat"])
            lon = float(pt["lon"])
            try:
                self.fetch_hourly_forecast(lat, lon, around=start)
            except WeatherProviderError:
                # weather_at will surface unavailable cells for this point.
                pass

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
