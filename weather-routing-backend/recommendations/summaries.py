"""Human-readable recommendation explanations."""

from __future__ import annotations

from typing import Any


def build_recommendation_summary(
    ranked_routes: list[dict[str, Any]],
    recommended: dict[str, Any] | None,
) -> dict[str, Any]:
    comparisons = []
    for route in ranked_routes:
        rs = route.get("risk_summary") or {}
        comparisons.append(
            {
                "route_id": route.get("id"),
                "rank": route.get("rank"),
                "severe_miles": rs.get("severe_miles"),
                "high_miles": rs.get("high_miles"),
                "average_risk": rs.get("average_risk"),
                "duration_seconds": route.get("duration_seconds"),
                "has_no_travel": rs.get("has_no_travel"),
                "coverage_percent": (rs.get("forecast_coverage") or {}).get("coverage_percent"),
            }
        )

    criteria = [
        "fewest_severe_miles",
        "fewest_high_miles",
        "lowest_average_risk",
        "shortest_duration",
    ]

    if recommended is None:
        return {
            "recommended_route_id": None,
            "safe_recommendation_available": False,
            "confidence": "none",
            "reason": (
                "No route can be recommended as safe: every candidate has No Travel "
                "segments and/or no usable forecast coverage."
            ),
            "ranking_criteria": criteria,
            "comparisons": comparisons,
        }

    rs = recommended.get("risk_summary") or {}
    coverage = rs.get("forecast_coverage") or {}
    coverage_pct = float(coverage.get("coverage_percent") or 0)
    incomplete = bool(rs.get("has_incomplete_forecast"))

    if coverage_pct <= 0:
        confidence = "low"
    elif coverage_pct >= 99 and not incomplete:
        confidence = "high"
    elif coverage_pct >= 50:
        confidence = "partial"
    else:
        confidence = "low"

    reason = (
        f"Route {recommended.get('rank')} is preferred with "
        f"{rs.get('severe_miles', 0)} severe miles, {rs.get('high_miles', 0)} high miles, "
        f"average risk {rs.get('average_risk', 0)} (0–4 scale), "
        f"and {recommended.get('duration_minutes')} minutes travel time. "
        f"Forecast coverage {coverage_pct}% "
        f"({coverage.get('checkpoints_with_forecast', 0)}/"
        f"{coverage.get('checkpoints_total', 0)} checkpoints)."
    )
    if coverage_pct <= 0:
        reason += (
            " Weather forecasts were unavailable for checkpoints on this run; "
            "ranking used travel time and known risk fields only."
        )
    elif incomplete:
        reason += (
            " Some checkpoints lack forecasts and are marked Unavailable "
            "(not counted as Low risk)."
        )

    return {
        "recommended_route_id": recommended.get("id"),
        "safe_recommendation_available": True,
        "confidence": confidence,
        "reason": reason,
        "ranking_criteria": criteria,
        "comparisons": comparisons,
    }
