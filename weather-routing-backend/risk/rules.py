"""
Risk classification thresholds for wind, rain, snow, and load adjustments.

All thresholds use:
- wind: mph
- rain: inches per hour
- snow: inches per hour
- load: pounds
"""

from __future__ import annotations

from shared.constants import RiskLevel


def classify_wind(wind_mph: float) -> RiskLevel:
    if wind_mph < 25:
        return RiskLevel.LOW
    if wind_mph < 35:
        return RiskLevel.MODERATE
    if wind_mph < 45:
        return RiskLevel.HIGH
    if wind_mph < 55:
        return RiskLevel.SEVERE
    return RiskLevel.NO_TRAVEL


def classify_rain(rain_in_hr: float) -> RiskLevel:
    if rain_in_hr < 0.10:
        return RiskLevel.LOW
    if rain_in_hr < 0.25:
        return RiskLevel.MODERATE
    if rain_in_hr < 0.50:
        return RiskLevel.HIGH
    if rain_in_hr <= 1.00:
        return RiskLevel.SEVERE
    return RiskLevel.NO_TRAVEL


def classify_snow(snow_in_hr: float) -> RiskLevel:
    if snow_in_hr < 0.5:
        return RiskLevel.LOW
    if snow_in_hr < 1.0:
        return RiskLevel.MODERATE
    if snow_in_hr < 2.0:
        return RiskLevel.HIGH
    if snow_in_hr <= 3.0:
        return RiskLevel.SEVERE
    return RiskLevel.NO_TRAVEL


def apply_load_adjustments(
    wind_mph: float,
    load_lb: float,
    wind_risk: RiskLevel,
) -> RiskLevel:
    """
    Load rules:
    - ≥55 mph → No Travel for any load
    - 45–54 mph + >30,000 lb → No Travel
    - 35–44 mph + >40,000 lb → Severe
    """
    if wind_mph >= 55:
        return RiskLevel.NO_TRAVEL
    if 45 <= wind_mph < 55 and load_lb > 30_000:
        return RiskLevel.NO_TRAVEL
    if 35 <= wind_mph < 45 and load_lb > 40_000:
        return max(wind_risk, RiskLevel.SEVERE)
    return wind_risk
