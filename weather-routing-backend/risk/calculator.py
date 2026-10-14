"""Checkpoint-level risk calculation independent of weather providers."""

from __future__ import annotations

from dataclasses import asdict, dataclass
from typing import Any

from risk.rules import apply_load_adjustments, classify_rain, classify_snow, classify_wind
from shared.constants import RiskLevel


@dataclass(frozen=True)
class WeatherMeasurements:
    wind_mph: float | None
    rain_in_hr: float | None
    snow_in_hr: float | None
    source: str = "open-meteo"
    available: bool = True
    notes: str = ""
    forecast_time: str | None = None
    forecast_delta_minutes: float | None = None


@dataclass(frozen=True)
class CheckpointRisk:
    wind_risk: str
    rain_risk: str
    snow_risk: str
    overall_risk: str
    overall_risk_score: int | None
    overall_risk_driver: str
    load_adjusted: bool
    evaluated: bool
    factors: list[str]
    primary_hazard: str | None = None

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


def calculate_checkpoint_risk(
    weather: WeatherMeasurements,
    load_lb: float,
) -> CheckpointRisk:
    """
    Overall checkpoint risk policy:
    Take the maximum of wind (after load adjustments), rain, and snow risks.

    Missing weather is NOT treated as Low — it is marked Unavailable so the
    UI and ranking can distinguish unevaluated segments from confirmed calm.
    """
    if not weather.available:
        return CheckpointRisk(
            wind_risk=RiskLevel.UNAVAILABLE.label(),
            rain_risk=RiskLevel.UNAVAILABLE.label(),
            snow_risk=RiskLevel.UNAVAILABLE.label(),
            overall_risk=RiskLevel.UNAVAILABLE.label(),
            overall_risk_score=None,
            overall_risk_driver="unavailable",
            load_adjusted=False,
            evaluated=False,
            factors=["weather_unavailable — not assumed Low"],
            primary_hazard="Forecast unavailable",
        )

    wind = float(weather.wind_mph or 0.0)
    rain = float(weather.rain_in_hr or 0.0)
    snow = float(weather.snow_in_hr or 0.0)

    base_wind = classify_wind(wind)
    rain_risk = classify_rain(rain)
    snow_risk = classify_snow(snow)
    adjusted_wind = apply_load_adjustments(wind, load_lb, base_wind)
    load_adjusted = adjusted_wind != base_wind or (
        wind >= 55
        or (45 <= wind < 55 and load_lb > 30_000)
        or (35 <= wind < 45 and load_lb > 40_000)
    )

    factors: list[str] = []
    if adjusted_wind != base_wind:
        factors.append(
            f"load_adjustment: wind {base_wind.label()} → {adjusted_wind.label()} "
            f"(load={load_lb:.0f} lb, wind={wind:.1f} mph)"
        )
    elif wind >= 55:
        factors.append("load_rule: wind ≥55 mph → No Travel")

    overall = max(adjusted_wind, rain_risk, snow_risk)
    factors.append(f"wind={adjusted_wind.label()} ({wind:.1f} mph)")
    factors.append(f"rain={rain_risk.label()} ({rain:.3f} in/hr)")
    factors.append(f"snow={snow_risk.label()} ({snow:.3f} in/hr)")
    factors.append(f"overall=max → {overall.label()}")
    if weather.forecast_time:
        factors.append(f"forecast_hour={weather.forecast_time}")

    if overall == RiskLevel.LOW:
        driver = "none"
    elif overall == adjusted_wind:
        driver = "wind"
    elif overall == rain_risk:
        driver = "rain"
    else:
        driver = "snow"

    # Concise primary hazard for UI (includes measured values)
    if overall == RiskLevel.LOW:
        primary = (
            f"All Low: wind {wind:.1f} mph, rain {rain:.3f} in/hr, snow {snow:.3f} in/hr"
        )
    elif driver == "wind":
        primary = f"Wind {wind:.1f} mph drives {adjusted_wind.label()} (load-adjusted)"
    elif driver == "rain":
        primary = f"Rain {rain:.3f} in/hr drives {rain_risk.label()}"
    else:
        primary = f"Snow {snow:.3f} in/hr drives {snow_risk.label()}"

    return CheckpointRisk(
        wind_risk=adjusted_wind.label(),
        rain_risk=rain_risk.label(),
        snow_risk=snow_risk.label(),
        overall_risk=overall.label(),
        overall_risk_score=int(overall),
        overall_risk_driver=driver,
        load_adjusted=load_adjusted,
        evaluated=True,
        factors=factors,
        primary_hazard=primary,
    )
