"""Route-level weather evidence derived from checkpoint forecasts."""

from __future__ import annotations

from typing import Any


def build_route_weather_summary(checkpoints: list[dict[str, Any]]) -> dict[str, Any]:
    evaluated = [cp for cp in checkpoints if (cp.get("weather") or {}).get("available")]
    unavailable = len(checkpoints) - len(evaluated)

    peak_wind = None
    peak_rain = None
    peak_snow = None
    if evaluated:
        peak_wind = max(float(cp["weather"]["wind_mph"] or 0) for cp in evaluated)
        peak_rain = max(float(cp["weather"]["rain_in_hr"] or 0) for cp in evaluated)
        peak_snow = max(float(cp["weather"]["snow_in_hr"] or 0) for cp in evaluated)

    samples: list[dict[str, Any]] = []
    for cp in checkpoints:
        w = cp.get("weather") or {}
        r = cp.get("risk") or {}
        samples.append(
            {
                "index": cp.get("index"),
                "distance_from_origin_miles": cp.get("distance_from_origin_miles"),
                "eta": cp.get("eta"),
                "forecast_time": w.get("forecast_time"),
                "forecast_delta_minutes": w.get("forecast_delta_minutes"),
                "available": w.get("available", False),
                "wind_mph": w.get("wind_mph"),
                "rain_in_hr": w.get("rain_in_hr"),
                "snow_in_hr": w.get("snow_in_hr"),
                "wind_risk": r.get("wind_risk"),
                "rain_risk": r.get("rain_risk"),
                "snow_risk": r.get("snow_risk"),
                "overall_risk": r.get("overall_risk"),
                "overall_risk_driver": r.get("overall_risk_driver"),
                "primary_hazard": r.get("primary_hazard"),
            }
        )

    return {
        "checkpoints_total": len(checkpoints),
        "checkpoints_evaluated": len(evaluated),
        "checkpoints_unavailable": unavailable,
        "peak_wind_mph": round(peak_wind, 3) if peak_wind is not None else None,
        "peak_rain_in_hr": round(peak_rain, 4) if peak_rain is not None else None,
        "peak_snow_in_hr": round(peak_snow, 4) if peak_snow is not None else None,
        "checkpoint_weather": samples,
        "eta_forecast_note": (
            "Measurements use hourly forecast data matched to each checkpoint truck ETA "
            "(nearest hour within 90 minutes). Corridor heatmap uses separate timeline offsets."
        ),
    }
