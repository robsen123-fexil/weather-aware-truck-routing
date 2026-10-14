"""Lightweight geospatial helpers (no heavy GIS dependencies)."""

from __future__ import annotations

import math
from typing import Sequence

EARTH_RADIUS_M = 6_371_000.0


def haversine_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    rlat1, rlon1, rlat2, rlon2 = map(math.radians, (lat1, lon1, lat2, lon2))
    dlat = rlat2 - rlat1
    dlon = rlon2 - rlon1
    a = math.sin(dlat / 2) ** 2 + math.cos(rlat1) * math.cos(rlat2) * math.sin(dlon / 2) ** 2
    return 2 * EARTH_RADIUS_M * math.asin(math.sqrt(a))


def interpolate(
    lat1: float,
    lon1: float,
    lat2: float,
    lon2: float,
    fraction: float,
) -> tuple[float, float]:
    """Linear interpolation in lat/lon space (sufficient for short road segments)."""
    fraction = min(1.0, max(0.0, fraction))
    return lat1 + (lat2 - lat1) * fraction, lon1 + (lon2 - lon1) * fraction


def cumulative_distances_m(coords: Sequence[tuple[float, float]]) -> list[float]:
    """coords as (lat, lon). Returns cumulative distance at each vertex."""
    if not coords:
        return []
    distances = [0.0]
    total = 0.0
    for i in range(1, len(coords)):
        lat1, lon1 = coords[i - 1]
        lat2, lon2 = coords[i]
        total += haversine_m(lat1, lon1, lat2, lon2)
        distances.append(total)
    return distances


def point_at_distance_m(
    coords: Sequence[tuple[float, float]],
    distances: Sequence[float],
    target_m: float,
) -> tuple[float, float]:
    """Return (lat, lon) at approximately target_m along the polyline."""
    if not coords:
        raise ValueError("Empty coordinate list")
    if target_m <= 0:
        return coords[0]
    total = distances[-1]
    if target_m >= total:
        return coords[-1]

    for i in range(1, len(coords)):
        if distances[i] >= target_m:
            seg_start = distances[i - 1]
            seg_end = distances[i]
            seg_len = seg_end - seg_start
            frac = 0.0 if seg_len <= 0 else (target_m - seg_start) / seg_len
            lat1, lon1 = coords[i - 1]
            lat2, lon2 = coords[i]
            return interpolate(lat1, lon1, lat2, lon2, frac)

    return coords[-1]
