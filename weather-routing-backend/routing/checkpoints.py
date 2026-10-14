"""Generate checkpoints along route geometry at fixed mile intervals."""

from __future__ import annotations

from typing import Any

from routing.geo import cumulative_distances_m, point_at_distance_m
from shared.constants import METERS_TO_MILES, MILES_TO_METERS


def generate_checkpoints(
    geometry: list[list[float]],
    *,
    interval_miles: float,
    total_distance_m: float | None = None,
) -> list[dict[str, Any]]:
    """
    Sample points every `interval_miles` along the route, plus origin and destination.

    `geometry` is a list of [lon, lat] (GeoJSON order) or [lat, lon] when
    coordinates look like absolute latitude values in the first position — we
    accept GeoJSON [lon, lat] as produced by OpenRouteService.
    """
    if interval_miles <= 0:
        raise ValueError("interval_miles must be positive")
    if not geometry or len(geometry) < 2:
        raise ValueError("Route geometry must contain at least two coordinates")

    # GeoJSON: [lon, lat] → internal (lat, lon)
    coords: list[tuple[float, float]] = [(float(p[1]), float(p[0])) for p in geometry]
    distances = cumulative_distances_m(coords)
    polyline_m = distances[-1]
    total_m = float(total_distance_m) if total_distance_m and total_distance_m > 0 else polyline_m
    # Prefer provider distance for mile markers when close; otherwise use polyline.
    scale = (total_m / polyline_m) if polyline_m > 0 else 1.0

    interval_m = interval_miles * MILES_TO_METERS
    targets: list[float] = [0.0]
    next_m = interval_m
    while next_m < total_m:
        targets.append(next_m)
        next_m += interval_m
    if not targets or abs(targets[-1] - total_m) > 1.0:
        targets.append(total_m)

    checkpoints: list[dict[str, Any]] = []
    for idx, target_m in enumerate(targets):
        # Map provider-distance target onto polyline space
        poly_target = (target_m / scale) if scale > 0 else target_m
        lat, lon = point_at_distance_m(coords, distances, poly_target)
        checkpoints.append(
            {
                "index": idx,
                "coordinates": {"lat": round(lat, 6), "lon": round(lon, 6)},
                "distance_from_origin_m": round(target_m, 2),
                "distance_from_origin_miles": round(target_m * METERS_TO_MILES, 3),
                "is_origin": idx == 0,
                "is_destination": idx == len(targets) - 1,
            }
        )
    return checkpoints
