"""Orchestrate routing → checkpoints → weather → risk → recommendation."""

from __future__ import annotations

import logging
from datetime import datetime
from typing import Any

from django.conf import settings

from recommendations.ranker import rank_routes, select_recommendation
from recommendations.summaries import build_recommendation_summary
from risk.calculator import calculate_checkpoint_risk
from risk.scoring import summarize_route_risk
from risk.weather_summary import build_route_weather_summary
from routing.checkpoints import generate_checkpoints
from routing.eta import attach_etas
from routing.services import get_routing_service
from weather.forecast import weather_to_dict
from weather.services import get_weather_service
from planner.store import get_route_store

logger = logging.getLogger(__name__)


class TripPlannerService:
    def __init__(self) -> None:
        self.routing = get_routing_service()
        self.weather = get_weather_service()
        self.store = get_route_store()

    def analyze_trip(
        self,
        *,
        origin: str,
        destination: str,
        departure: datetime,
        load_weight_lb: float,
        checkpoint_interval_miles: int | None = None,
        include_heatmap_points: bool = False,
    ) -> dict[str, Any]:
        interval = checkpoint_interval_miles or int(
            getattr(settings, "DEFAULT_CHECKPOINT_INTERVAL_MILES", 25)
        )

        origin_geo = self.routing.geocode(origin)
        dest_geo = self.routing.geocode(destination)
        raw_routes = self.routing.fetch_routes(origin_geo, dest_geo, max_alternatives=3)

        analyzed: list[dict[str, Any]] = []
        warnings: list[str] = []

        if len(raw_routes) < 3:
            warnings.append(
                f"routing_alternatives:{len(raw_routes)}"
            )

        # Build checkpoints first, then warm a small set of weather cells.
        # Free Open-Meteo rate-limits hard if we fan out every checkpoint.
        prepared: list[tuple[dict[str, Any], list[dict[str, Any]]]] = []
        weather_points: list[tuple[float, float]] = []
        for raw in raw_routes:
            checkpoints = generate_checkpoints(
                raw["geometry"]["coordinates"],
                interval_miles=float(interval),
                total_distance_m=raw["distance_m"],
            )
            checkpoints = attach_etas(
                checkpoints,
                departure=departure,
                duration_seconds=raw["duration_seconds"],
                total_distance_m=raw["distance_m"],
            )
            prepared.append((raw, checkpoints))
            # Prefer endpoints + midpoints so short trips still get coverage
            # without one HTTP call per near-duplicate checkpoint.
            n = len(checkpoints)
            if n == 0:
                continue
            indexes = {0, n - 1}
            if n > 2:
                indexes.add(n // 2)
            if n > 4:
                indexes.add(n // 4)
                indexes.add((3 * n) // 4)
            for i in sorted(indexes):
                cp = checkpoints[i]
                weather_points.append(
                    (cp["coordinates"]["lat"], cp["coordinates"]["lon"])
                )

        try:
            self.weather.prefetch_locations(weather_points)
        except Exception:  # noqa: BLE001
            logger.exception("Weather prefetch failed; continuing with on-demand fetches")

        for raw, checkpoints in prepared:
            try:
                route = self._analyze_single_route(
                    raw,
                    departure=departure,
                    load_weight_lb=load_weight_lb,
                    interval_miles=interval,
                    checkpoints=checkpoints,
                )
                analyzed.append(route)
                self.store.put(route["id"], route)
            except Exception:  # noqa: BLE001
                logger.exception("Failed analyzing route %s", raw.get("id"))
                route_label = raw.get("id") or "an alternative"
                warnings.append(
                    f"One route alternative ({route_label}) could not be fully analyzed "
                    "and was skipped."
                )

        ranked = rank_routes(analyzed)
        recommended = select_recommendation(ranked)
        recommendation = build_recommendation_summary(ranked, recommended)

        if any((r.get("risk_summary") or {}).get("has_incomplete_forecast") for r in ranked):
            warnings.append(
                "One or more routes have checkpoints without an available forecast. "
                "Unavailable segments are not counted as Low risk."
            )

        result: dict[str, Any] = {
            "request": {
                "origin": origin,
                "destination": destination,
                "departure": departure.isoformat(),
                "load_weight_lb": load_weight_lb,
                "checkpoint_interval_miles": interval,
            },
            "geocoded": {
                "origin": origin_geo,
                "destination": dest_geo,
            },
            "routes": ranked,
            "recommendation": recommendation,
            "warnings": warnings,
            "assumptions": {
                "risk_miles": (
                    "Each segment between consecutive checkpoints inherits the overall "
                    "risk of the ending checkpoint. Segment length is the difference in "
                    "distance-from-origin. Origin contributes 0 miles; destination is included. "
                    "Unavailable forecasts are tracked separately and are not counted as Low."
                ),
                "eta": (
                    "ETA scales linearly with distance using provider duration / distance "
                    "(constant average speed)."
                ),
                "forecast_match": (
                    "Hourly forecast data is matched to each checkpoint ETA (UTC). "
                    "The nearest hour within 90 minutes is used; the matched forecast "
                    "timestamp is returned as weather.forecast_time."
                ),
                "overall_risk": (
                    "Checkpoint overall risk is the maximum of load-adjusted wind, rain, "
                    "and snow risk levels. Missing forecasts are overall=Unavailable."
                ),
                "no_travel": (
                    "Routes containing any No Travel checkpoint/segment cannot be recommended "
                    "as safe. Incomplete forecast coverage reduces recommendation confidence."
                ),
            },
        }

        if include_heatmap_points and ranked:
            seed = recommended or ranked[0]
            points = [
                {
                    "lat": cp["coordinates"]["lat"],
                    "lon": cp["coordinates"]["lon"],
                }
                for cp in seed.get("checkpoints", [])
            ]
            result["heatmap_seed_points"] = points

        return result

    def _analyze_single_route(
        self,
        raw: dict[str, Any],
        *,
        departure: datetime,
        load_weight_lb: float,
        interval_miles: int,
        checkpoints: list[dict[str, Any]] | None = None,
    ) -> dict[str, Any]:
        if checkpoints is None:
            coords = raw["geometry"]["coordinates"]
            checkpoints = generate_checkpoints(
                coords,
                interval_miles=float(interval_miles),
                total_distance_m=raw["distance_m"],
            )
            checkpoints = attach_etas(
                checkpoints,
                departure=departure,
                duration_seconds=raw["duration_seconds"],
                total_distance_m=raw["distance_m"],
            )

        enriched_cps: list[dict[str, Any]] = []
        for cp in checkpoints:
            eta = datetime.fromisoformat(cp["eta"])
            lat = cp["coordinates"]["lat"]
            lon = cp["coordinates"]["lon"]
            weather = self.weather.weather_at(lat, lon, eta)
            risk = calculate_checkpoint_risk(weather, load_weight_lb)
            item = dict(cp)
            item["weather"] = weather_to_dict(weather)
            item["risk"] = risk.to_dict()
            enriched_cps.append(item)

        risk_summary = summarize_route_risk(enriched_cps)
        coverage = risk_summary.forecast_coverage
        warnings: list[str] = []
        variant = raw.get("variant") or "provider_alternative"
        if variant == "via_detour":
            warnings.append(
                "Alternative requested from the routing provider via an intermediate "
                "waypoint to force a different road path. Geometry is the provider's "
                "real driving route."
            )
        if risk_summary.has_no_travel:
            warnings.append("Route contains No Travel segments")
        if risk_summary.has_incomplete_forecast:
            warnings.append(
                f"Forecast coverage {coverage['coverage_percent']}% "
                f"({coverage['checkpoints_with_forecast']}/"
                f"{coverage['checkpoints_total']} checkpoints)"
            )

        return {
            "id": raw["id"],
            "provider": raw.get("provider"),
            "profile": raw.get("profile"),
            "alternative_index": raw.get("alternative_index"),
            "variant": variant,
            "geometry": raw["geometry"],
            "distance_m": raw["distance_m"],
            "distance_miles": raw["distance_miles"],
            "duration_seconds": raw["duration_seconds"],
            "duration_minutes": raw["duration_minutes"],
            "checkpoints": enriched_cps,
            "risk_summary": risk_summary.to_dict(),
            "weather_summary": build_route_weather_summary(enriched_cps),
            "warnings": warnings,
        }


def get_trip_planner() -> TripPlannerService:
    return TripPlannerService()
