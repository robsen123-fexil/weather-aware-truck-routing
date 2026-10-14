"""Lexicographic route ranking by safety, then risk score, then travel time."""

from __future__ import annotations

from typing import Any


def ranking_key(route: dict[str, Any]) -> tuple:
    """
    Prefer:
    1. Fewest Severe miles
    2. Fewest High miles
    3. Lowest average risk
    4. Shortest travel duration

    Routes with No Travel segments are ranked after all safe routes.
    Incomplete forecast does not change ranking priority, but affects
    whether a route can be recommended as confidently safe.
    """
    summary = route.get("risk_summary") or {}
    has_no_travel = bool(summary.get("has_no_travel"))
    return (
        1 if has_no_travel else 0,
        float(summary.get("severe_miles") or 0.0),
        float(summary.get("high_miles") or 0.0),
        float(summary.get("average_risk") or 0.0),
        float(route.get("duration_seconds") or 0.0),
    )


def rank_routes(routes: list[dict[str, Any]]) -> list[dict[str, Any]]:
    ordered = sorted(routes, key=ranking_key)
    ranked: list[dict[str, Any]] = []
    for i, route in enumerate(ordered, start=1):
        item = dict(route)
        item["rank"] = i
        ranked.append(item)
    return ranked


def select_recommendation(ranked_routes: list[dict[str, Any]]) -> dict[str, Any] | None:
    """
    Recommend the top-ranked route that has no No-Travel segments.

    Prefer routes with some forecast coverage. If every candidate lacks weather
    data (provider outage / rate limit), still recommend the top non-No-Travel
    route with low confidence rather than leaving the UI with no pick.
    """
    fallback: dict[str, Any] | None = None
    for route in ranked_routes:
        summary = route.get("risk_summary") or {}
        if summary.get("has_no_travel"):
            continue
        if fallback is None:
            fallback = route
        coverage = summary.get("forecast_coverage") or {}
        if float(coverage.get("coverage_percent") or 0) > 0:
            return route
    return fallback