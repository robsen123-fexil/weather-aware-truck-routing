"""Open-Meteo weather forecast client."""

from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from typing import Any

import requests
from django.conf import settings

from risk.calculator import WeatherMeasurements
from shared.exceptions import WeatherProviderError
from weather.forecast import normalize_open_meteo_hour, weather_to_dict

logger = logging.getLogger(__name__)


class WeatherService:
    def __init__(self) -> None:
        self.base_url = getattr(
            settings,
            "OPEN_METEO_BASE_URL",
            "https://api.open-meteo.com/v1",
        ).rstrip("/")
        self.timeout = getattr(settings, "HTTP_TIMEOUT_SECONDS", 30)
        self._cache: dict[str, dict[str, Any]] = {}

    def _cache_key(self, lat: float, lon: float, start: str, end: str) -> str:
        return f"{round(lat, 3)}:{round(lon, 3)}:{start}:{end}"

    def fetch_hourly_forecast(
        self,
        lat: float,
        lon: float,
        *,
        around: datetime | None = None,
    ) -> dict[str, Any]:
        """
        Fetch hourly forecast covering the trip timeline.

        Uses start_date/end_date so checkpoint ETAs (not only 'now') are covered.
        Open-Meteo forecast horizon is typically ~16 days ahead.
        """
        around = around or datetime.now(timezone.utc)
        if around.tzinfo is None:
            around = around.replace(tzinfo=timezone.utc)

        # Pad so nearby hours on either side of ETA are available.
        start_day = (around - timedelta(days=1)).date().isoformat()
        end_day = (around + timedelta(days=2)).date().isoformat()
        key = self._cache_key(lat, lon, start_day, end_day)
        if key in self._cache:
            return self._cache[key]

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
        url = f"{self.base_url}/forecast"
        try:
            response = requests.get(url, params=params, timeout=self.timeout)
        except requests.RequestException as exc:
            raise WeatherProviderError(f"Weather request failed: {exc}") from exc

        if response.status_code == 429:
            raise WeatherProviderError("Weather API rate limit exceeded.", status=429)
        if response.status_code >= 400:
            # Fallback to forecast_days window for providers that reject date range
            logger.warning(
                "Dated forecast failed (%s); falling back to forecast_days",
                response.status_code,
            )
            return self._fetch_forecast_days(lat, lon)

        data = response.json()
        self._cache[key] = data
        return data

    def _fetch_forecast_days(self, lat: float, lon: float) -> dict[str, Any]:
        key = self._cache_key(lat, lon, "fd7", "fd7")
        if key in self._cache:
            return self._cache[key]
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
        response = requests.get(
            f"{self.base_url}/forecast",
            params=params,
            timeout=self.timeout,
        )
        if response.status_code >= 400:
            raise WeatherProviderError(
                f"Weather API error ({response.status_code}): {response.text[:300]}",
                status=502,
            )
        data = response.json()
        self._cache[key] = data
        return data

    def weather_at(
        self,
        lat: float,
        lon: float,
        when: datetime,
    ) -> WeatherMeasurements:
        if when.tzinfo is None:
            when = when.replace(tzinfo=timezone.utc)

        try:
            payload = self.fetch_hourly_forecast(lat, lon, around=when)
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
        """
        if hours < 0 or hours > 48:
            raise WeatherProviderError("hours must be between 0 and 48", status=400)
        start = start or datetime.now(timezone.utc)
        if start.tzinfo is None:
            start = start.replace(tzinfo=timezone.utc)

        frames: list[dict[str, Any]] = []
        for h in range(0, hours + 1, max(1, step_hours)):
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
            "step_hours": step_hours,
            "note": (
                "Heatmap frames are forecast-hour snapshots along the corridor, "
                "distinct from ETA-matched checkpoint risk used for route ranking."
            ),
            "frames": frames,
        }


def get_weather_service() -> WeatherService:
    return WeatherService()
