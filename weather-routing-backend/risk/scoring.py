"""
Route-level risk metrics derived from checkpoint risk levels.

Assumptions:
- Checkpoints are ordered origin → destination along the route.
- The segment ending at checkpoint i (from checkpoint i-1, or from mile 0 for
  the first post-origin sample) is attributed the overall risk of checkpoint i.
- Segment length = distance_from_origin[i] − distance_from_origin[i-1].
- The destination checkpoint is included so the final partial interval is counted.
- Origin-only (distance 0) contributes 0 miles.
- Unavailable forecast segments are tracked separately and are NOT counted as Low.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass
from typing import Any, Iterable

from shared.constants import RiskLevel


@dataclass
class RouteRiskSummary:
    severe_miles: float
    high_miles: float
    moderate_miles: float
    low_miles: float
    no_travel_miles: float
    unavailable_miles: float
    total_risk_miles: float
    evaluated_miles: float
    average_risk: float
    highest_risk: str
    has_no_travel: bool
    has_incomplete_forecast: bool
    no_travel_segments: list[dict[str, Any]]
    risk_mile_breakdown: dict[str, float]
    forecast_coverage: dict[str, Any]

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


def _miles_between(prev_miles: float, curr_miles: float) -> float:
    return max(0.0, float(curr_miles) - float(prev_miles))


def summarize_route_risk(checkpoints: Iterable[dict[str, Any]]) -> RouteRiskSummary:
    """
    Aggregate risk-miles and average risk from analyzed checkpoints.

    Average risk = sum(segment_miles * risk_score) / evaluated_miles
    (unavailable segments excluded from the average).
    """
    ordered = list(checkpoints)
    buckets = {
        RiskLevel.LOW: 0.0,
        RiskLevel.MODERATE: 0.0,
        RiskLevel.HIGH: 0.0,
        RiskLevel.SEVERE: 0.0,
        RiskLevel.NO_TRAVEL: 0.0,
        RiskLevel.UNAVAILABLE: 0.0,
    }
    weighted = 0.0
    evaluated_miles = 0.0
    total_miles = 0.0
    no_travel_segments: list[dict[str, Any]] = []
    highest = RiskLevel.UNAVAILABLE

    cps_total = len(ordered)
    cps_available = 0
    cps_unavailable = 0

    prev_miles = 0.0
    for idx, cp in enumerate(ordered):
        weather = cp.get("weather") or {}
        risk = cp.get("risk") or {}
        available = bool(weather.get("available", risk.get("evaluated", False)))
        if available:
            cps_available += 1
        else:
            cps_unavailable += 1

        curr_miles = float(cp.get("distance_from_origin_miles", 0.0))
        segment = _miles_between(prev_miles, curr_miles)
        risk_label = risk.get("overall_risk") or (
            RiskLevel.LOW.label() if available else RiskLevel.UNAVAILABLE.label()
        )
        try:
            level = RiskLevel.from_label(risk_label)
        except ValueError:
            level = RiskLevel.UNAVAILABLE if not available else RiskLevel.LOW

        if segment > 0:
            buckets[level] += segment
            total_miles += segment
            if level != RiskLevel.UNAVAILABLE:
                weighted += segment * int(level)
                evaluated_miles += segment
                if level > highest:
                    highest = level

            if level == RiskLevel.NO_TRAVEL:
                no_travel_segments.append(
                    {
                        "from_miles": round(prev_miles, 3),
                        "to_miles": round(curr_miles, 3),
                        "miles": round(segment, 3),
                        "checkpoint_index": idx,
                        "coordinates": cp.get("coordinates"),
                        "eta": cp.get("eta"),
                    }
                )

        prev_miles = curr_miles
        if available and level != RiskLevel.UNAVAILABLE and level > highest:
            highest = level

    # Highest among checkpoint overall risks (including when segment=0 origin)
    for cp in ordered:
        label = (cp.get("risk") or {}).get("overall_risk", "Unavailable")
        try:
            level = RiskLevel.from_label(label)
        except ValueError:
            continue
        if level != RiskLevel.UNAVAILABLE and level > highest:
            highest = level

    average = (weighted / evaluated_miles) if evaluated_miles > 0 else 0.0
    coverage_pct = round(100.0 * cps_available / cps_total, 1) if cps_total else 0.0

    if highest == RiskLevel.UNAVAILABLE and evaluated_miles <= 0:
        highest_label = RiskLevel.UNAVAILABLE.label()
    elif highest == RiskLevel.UNAVAILABLE:
        highest_label = RiskLevel.LOW.label()
    else:
        highest_label = highest.label()

    return RouteRiskSummary(
        severe_miles=round(buckets[RiskLevel.SEVERE], 3),
        high_miles=round(buckets[RiskLevel.HIGH], 3),
        moderate_miles=round(buckets[RiskLevel.MODERATE], 3),
        low_miles=round(buckets[RiskLevel.LOW], 3),
        no_travel_miles=round(buckets[RiskLevel.NO_TRAVEL], 3),
        unavailable_miles=round(buckets[RiskLevel.UNAVAILABLE], 3),
        total_risk_miles=round(total_miles, 3),
        evaluated_miles=round(evaluated_miles, 3),
        average_risk=round(average, 4),
        highest_risk=highest_label,
        has_no_travel=buckets[RiskLevel.NO_TRAVEL] > 0
        or any(
            RiskLevel.from_label((cp.get("risk") or {}).get("overall_risk", "Unavailable"))
            == RiskLevel.NO_TRAVEL
            for cp in ordered
            if (cp.get("risk") or {}).get("overall_risk")
        ),
        has_incomplete_forecast=cps_unavailable > 0 or buckets[RiskLevel.UNAVAILABLE] > 0,
        no_travel_segments=no_travel_segments,
        risk_mile_breakdown={
            "Low": round(buckets[RiskLevel.LOW], 3),
            "Moderate": round(buckets[RiskLevel.MODERATE], 3),
            "High": round(buckets[RiskLevel.HIGH], 3),
            "Severe": round(buckets[RiskLevel.SEVERE], 3),
            "No Travel": round(buckets[RiskLevel.NO_TRAVEL], 3),
            "Unavailable": round(buckets[RiskLevel.UNAVAILABLE], 3),
        },
        forecast_coverage={
            "checkpoints_total": cps_total,
            "checkpoints_with_forecast": cps_available,
            "checkpoints_without_forecast": cps_unavailable,
            "coverage_percent": coverage_pct,
        },
    )
