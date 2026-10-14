"""Estimate checkpoint arrival times from departure and cumulative duration."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any


def _ensure_aware(dt: datetime) -> datetime:
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt


def attach_etas(
    checkpoints: list[dict[str, Any]],
    *,
    departure: datetime,
    duration_seconds: float,
    total_distance_m: float,
) -> list[dict[str, Any]]:
    """
    ETA assumption: travel progress is proportional to distance along the route
    (constant average speed implied by provider duration / distance).

    eta = departure + duration * (distance_from_origin / total_distance)
    """
    departure = _ensure_aware(departure)
    total_distance_m = max(float(total_distance_m), 1.0)
    duration_seconds = max(float(duration_seconds), 0.0)

    enriched: list[dict[str, Any]] = []
    for cp in checkpoints:
        dist = float(cp.get("distance_from_origin_m", 0.0))
        fraction = min(1.0, max(0.0, dist / total_distance_m))
        offset = timedelta(seconds=duration_seconds * fraction)
        eta = departure + offset
        item = dict(cp)
        item["eta"] = eta.isoformat()
        item["eta_offset_seconds"] = round(duration_seconds * fraction, 1)
        item["progress_fraction"] = round(fraction, 6)
        enriched.append(item)
    return enriched
