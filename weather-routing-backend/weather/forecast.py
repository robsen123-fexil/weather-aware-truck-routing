"""Normalize weather provider payloads into internal measurements."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from risk.calculator import WeatherMeasurements
from shared.constants import CM_TO_INCH, KMH_TO_MPH, MM_TO_INCH, MPS_TO_MPH


def _parse_iso(value: str) -> datetime:
    text = value.replace("Z", "+00:00")
    dt = datetime.fromisoformat(text)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt


def nearest_hourly_index(times: list[str], target: datetime) -> tuple[int, float] | None:
    """Return (index, abs_delta_seconds) for the nearest hour, or None if >90 minutes away."""
    if not times:
        return None
    target = target.astimezone(timezone.utc)
    best_i = 0
    best_delta = abs((_parse_iso(times[0]) - target).total_seconds())
    for i, t in enumerate(times[1:], start=1):
        delta = abs((_parse_iso(t) - target).total_seconds())
        if delta < best_delta:
            best_delta = delta
            best_i = i
    # Open-Meteo hourly grid; reject if farther than ~90 minutes
    if best_delta > 90 * 60:
        return None
    return best_i, best_delta


def convert_wind_to_mph(value: float, unit: str) -> float:
    unit = (unit or "mph").lower().replace(" ", "")
    if unit in {"mph", "mi/h", "mp/h"}:
        return float(value)
    if unit in {"kmh", "km/h"}:
        return float(value) * KMH_TO_MPH
    if unit in {"ms", "m/s"}:
        return float(value) * MPS_TO_MPH
    return float(value)


def convert_precip_to_in_hr(value: float, unit: str) -> float:
    """Hourly precipitation amount → in/hr."""
    unit = (unit or "inch").lower()
    if unit in {"inch", "in", "inch/h", "in/hr"}:
        return float(value)
    if unit in {"mm", "mm/h"}:
        return float(value) * MM_TO_INCH
    return float(value)


def convert_snow_to_in_hr(value: float, unit: str) -> float:
    unit = (unit or "cm").lower()
    if unit in {"inch", "in", "inch/h", "in/hr"}:
        return float(value)
    if unit in {"cm", "cm/h"}:
        return float(value) * CM_TO_INCH
    if unit in {"mm", "mm/h"}:
        return float(value) * MM_TO_INCH
    return float(value)


def _unavailable(notes: str) -> WeatherMeasurements:
    return WeatherMeasurements(
        wind_mph=None,
        rain_in_hr=None,
        snow_in_hr=None,
        available=False,
        notes=notes,
        forecast_time=None,
        forecast_delta_minutes=None,
    )


def normalize_open_meteo_hour(
    payload: dict[str, Any],
    *,
    target_time: datetime,
) -> WeatherMeasurements:
    hourly = payload.get("hourly") or {}
    units = payload.get("hourly_units") or {}
    times = hourly.get("time") or []
    match = nearest_hourly_index(times, target_time)
    if match is None:
        return _unavailable(
            "No hourly forecast within 90 minutes of checkpoint ETA "
            "(outside provider coverage or timeline mismatch)"
        )

    idx, delta_sec = match
    wind_raw = (hourly.get("wind_speed_10m") or [None])[idx]
    precip_raw = (hourly.get("precipitation") or [None])[idx]
    rain_raw = (hourly.get("rain") or [None])[idx]
    snow_raw = (hourly.get("snowfall") or [None])[idx]

    if wind_raw is None and precip_raw is None and rain_raw is None and snow_raw is None:
        return _unavailable("Hourly values missing for selected forecast hour")

    wind = convert_wind_to_mph(float(wind_raw or 0.0), units.get("wind_speed_10m", "mph"))
    if rain_raw is not None:
        rain = convert_precip_to_in_hr(float(rain_raw), units.get("rain", "inch"))
    else:
        rain = convert_precip_to_in_hr(
            float(precip_raw or 0.0),
            units.get("precipitation", "inch"),
        )

    snow = convert_snow_to_in_hr(float(snow_raw or 0.0), units.get("snowfall", "cm"))
    forecast_time = times[idx]
    # Normalize to ISO with UTC
    try:
        forecast_iso = _parse_iso(forecast_time).isoformat()
    except ValueError:
        forecast_iso = forecast_time

    return WeatherMeasurements(
        wind_mph=round(wind, 3),
        rain_in_hr=round(max(0.0, rain), 4),
        snow_in_hr=round(max(0.0, snow), 4),
        available=True,
        notes=(
            f"Matched hourly forecast stamp {forecast_time}; "
            f"ETA offset {delta_sec / 60:.1f} min from forecast hour"
        ),
        forecast_time=forecast_iso,
        forecast_delta_minutes=round(delta_sec / 60.0, 1),
    )


def weather_to_dict(weather: WeatherMeasurements) -> dict[str, Any]:
    return {
        # null when unavailable — never imply confirmed zeros
        "wind_mph": weather.wind_mph,
        "rain_in_hr": weather.rain_in_hr,
        "snow_in_hr": weather.snow_in_hr,
        "source": weather.source,
        "available": weather.available,
        "notes": weather.notes,
        "forecast_time": weather.forecast_time,
        "forecast_delta_minutes": weather.forecast_delta_minutes,
    }
