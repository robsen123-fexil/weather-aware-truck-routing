"""OpenRouteService integration for geocoding and multi-route directions."""

from __future__ import annotations

import logging
import math
import uuid
from typing import Any

import requests
from django.conf import settings

from shared.exceptions import GeocodingError, RoutingError, ValidationAppError

logger = logging.getLogger(__name__)

# Process-wide geocode / suggest caches — cuts Nominatim 429s from autocomplete + analyze.
_GEOCODE_CACHE: dict[str, dict[str, Any]] = {}
_SUGGEST_CACHE: dict[str, list[dict[str, Any]]] = {}
_CACHE_MAX = 256


def _cache_put(cache: dict[str, Any], key: str, value: Any) -> None:
    if len(cache) >= _CACHE_MAX:
        cache.pop(next(iter(cache)), None)
    cache[key] = value


class RoutingService:
    def __init__(self) -> None:
        self.api_key = getattr(settings, "OPENROUTESERVICE_API_KEY", "") or ""
        self.timeout = getattr(settings, "HTTP_TIMEOUT_SECONDS", 30)
        self.profile = getattr(settings, "ROUTING_PROFILE", "driving-hgv")
        self.base = "https://api.openrouteservice.org"

    def _auth_header(self) -> str:
        if not self.api_key:
            raise RoutingError(
                "OPENROUTESERVICE_API_KEY is not configured. "
                "Set it in your .env file.",
                status=503,
            )
        # Newer ORS JWT-style keys require the Bearer scheme.
        if self.api_key.lower().startswith("bearer "):
            return self.api_key
        return f"Bearer {self.api_key}"

    def _headers(self) -> dict[str, str]:
        return {
            "Authorization": self._auth_header(),
            "Content-Type": "application/json",
            "Accept": "application/json, application/geo+json",
        }

    def geocode(self, place: str) -> dict[str, Any]:
        """Resolve a free-text place into coordinates."""
        place = (place or "").strip()
        if not place:
            raise ValidationAppError("Origin and destination must be non-empty.")

        # Allow "lat,lon" passthrough
        if "," in place:
            parts = [p.strip() for p in place.split(",")]
            if len(parts) == 2:
                try:
                    a, b = float(parts[0]), float(parts[1])
                    # Heuristic: if |a|<=90 and |b|<=180 treat as lat,lon
                    if abs(a) <= 90 and abs(b) <= 180:
                        return {
                            "label": place,
                            "lat": a,
                            "lon": b,
                            "source": "coordinates",
                        }
                except ValueError:
                    pass

        cache_key = place.casefold()
        cached = _GEOCODE_CACHE.get(cache_key)
        if cached is not None:
            return dict(cached)

        # Prefer ORS when keyed — Nominatim public API rate-limits hard (429)
        # after autocomplete traffic. Fall back the other way if needed.
        errors: list[str] = []
        if self.api_key:
            try:
                result = self._geocode_ors(place)
                _cache_put(_GEOCODE_CACHE, cache_key, result)
                return result
            except (GeocodingError, requests.RequestException) as exc:
                errors.append(f"ORS: {exc}")
                logger.warning("ORS geocoding failed (%s); trying Nominatim", exc)

        try:
            result = self._geocode_nominatim(place)
            _cache_put(_GEOCODE_CACHE, cache_key, result)
            return result
        except (GeocodingError, requests.RequestException) as exc:
            errors.append(f"Nominatim: {exc}")
            logger.warning("Nominatim geocoding failed (%s)", exc)
            if self.api_key:
                # Already tried ORS first; no further fallback.
                pass
            else:
                try:
                    result = self._geocode_ors(place)
                    _cache_put(_GEOCODE_CACHE, cache_key, result)
                    return result
                except (GeocodingError, requests.RequestException) as ors_exc:
                    errors.append(f"ORS: {ors_exc}")

        # Prefer surfacing rate-limit clearly when that is what happened.
        joined = " | ".join(errors) if errors else "Geocoding failed."
        status = 429 if "429" in joined or "rate limit" in joined.lower() else 502
        raise GeocodingError(
            "Place lookup is temporarily rate-limited. Wait a moment, or pick a "
            "suggestion again so we can use saved coordinates."
            if status == 429
            else f"Could not resolve '{place}'.",
            status=status,
        )

    def _geocode_ors(self, place: str) -> dict[str, Any]:
        url = f"{self.base}/geocode/search"
        response = requests.get(
            url,
            params={"text": place, "size": 1},
            headers={"Authorization": self._auth_header()},
            timeout=self.timeout,
        )
        if response.status_code == 429:
            raise GeocodingError("Geocoding rate limit exceeded. Try again shortly.", status=429)
        if response.status_code >= 400:
            raise GeocodingError(
                f"Geocoding failed ({response.status_code}): {response.text[:200]}",
                status=502,
            )

        features = (response.json().get("features") or [])
        if not features:
            raise GeocodingError(f"No results found for '{place}'.")

        feature = features[0]
        lon, lat = feature["geometry"]["coordinates"]
        props = feature.get("properties") or {}
        return {
            "label": props.get("label") or place,
            "lat": float(lat),
            "lon": float(lon),
            "source": "openrouteservice",
            "confidence": props.get("confidence"),
        }

    def _geocode_nominatim(self, place: str) -> dict[str, Any]:
        """OpenStreetMap Nominatim fallback (no API key)."""
        try:
            response = requests.get(
                "https://nominatim.openstreetmap.org/search",
                params={"q": place, "format": "json", "limit": 1},
                headers={"User-Agent": "weather-aware-truck-routing/1.0 (contact: local-dev)"},
                timeout=self.timeout,
            )
        except requests.RequestException as exc:
            raise GeocodingError(f"Geocoding request failed: {exc}") from exc

        if response.status_code == 429:
            raise GeocodingError(
                "Geocoding rate limit exceeded. Try again shortly.",
                status=429,
            )
        if response.status_code >= 400:
            raise GeocodingError(
                f"Geocoding failed ({response.status_code})",
                status=502,
            )

        results = response.json() or []
        if not results:
            raise GeocodingError(f"No results found for '{place}'.")

        hit = results[0]
        return {
            "label": hit.get("display_name") or place,
            "lat": float(hit["lat"]),
            "lon": float(hit["lon"]),
            "source": "nominatim",
        }

    def reverse_geocode(self, lat: float, lon: float) -> dict[str, Any]:
        """Resolve coordinates to a human place name (Nominatim, no API key)."""
        try:
            response = requests.get(
                "https://nominatim.openstreetmap.org/reverse",
                params={
                    "lat": lat,
                    "lon": lon,
                    "format": "json",
                    "addressdetails": 1,
                    "zoom": 18,  # building / street level when available
                },
                headers={"User-Agent": "weather-aware-truck-routing/1.0"},
                timeout=min(self.timeout, 12),
            )
            response.raise_for_status()
            data = response.json() or {}
        except requests.RequestException as exc:
            raise GeocodingError(f"Reverse geocoding failed: {exc}") from exc

        address = data.get("address") or {}
        city = (
            address.get("city")
            or address.get("town")
            or address.get("village")
            or address.get("municipality")
            or address.get("county")
        )
        state = address.get("state") or address.get("region")
        country = address.get("country")
        road = address.get("road") or address.get("pedestrian") or address.get("path")
        neighbourhood = (
            address.get("neighbourhood")
            or address.get("suburb")
            or address.get("quarter")
            or address.get("hamlet")
        )
        house = address.get("house_number")

        # Build a readable "where I am" name (prefer street → city → region).
        parts: list[str] = []
        if road and house:
            parts.append(f"{house} {road}")
        elif road:
            parts.append(road)
        if neighbourhood and neighbourhood not in parts:
            parts.append(neighbourhood)
        if city and city not in parts:
            parts.append(city)
        if state and state not in parts:
            parts.append(state)
        if country and country not in parts:
            parts.append(country)

        short_label = ", ".join(parts) if parts else ""
        full_label = (data.get("display_name") or "").strip()
        label = short_label or full_label or f"{lat:.5f},{lon:.5f}"

        return {
            "label": label,
            "full_label": full_label or label,
            "lat": float(data.get("lat") or lat),
            "lon": float(data.get("lon") or lon),
            "country": country,
            "state": state,
            "city": city,
            "road": road,
            "source": "nominatim-reverse",
        }

    def suggest_places(self, query: str, *, limit: int = 6) -> list[dict[str, Any]]:
        """
        Place autocomplete suggestions (cities/regions/countries).

        Uses Nominatim (no API key). Returns an empty list on failure so the
        UI can keep typing without hard errors.
        """
        query = (query or "").strip()
        if len(query) < 1:
            return []

        limit = max(1, min(int(limit), 10))
        cache_key = f"{query.casefold()}|{limit}"
        cached = _SUGGEST_CACHE.get(cache_key)
        if cached is not None:
            return [dict(item) for item in cached]

        try:
            response = requests.get(
                "https://nominatim.openstreetmap.org/search",
                params={
                    "q": query,
                    "format": "json",
                    "addressdetails": 1,
                    "limit": limit,
                },
                headers={"User-Agent": "weather-aware-truck-routing/1.0 (contact: local-dev)"},
                timeout=min(self.timeout, 12),
            )
            if response.status_code == 429:
                logger.warning("Place suggest rate-limited by Nominatim")
                return []
            response.raise_for_status()
            results = response.json() or []
        except requests.RequestException as exc:
            logger.warning("Place suggest failed: %s", exc)
            return []

        suggestions: list[dict[str, Any]] = []
        seen: set[str] = set()
        for hit in results:
            label = (hit.get("display_name") or "").strip()
            if not label or label.lower() in seen:
                continue
            seen.add(label.lower())
            address = hit.get("address") or {}
            suggestions.append(
                {
                    "label": label,
                    "lat": float(hit["lat"]),
                    "lon": float(hit["lon"]),
                    "type": hit.get("type") or hit.get("class") or "place",
                    "country": address.get("country"),
                    "state": address.get("state") or address.get("region"),
                    "city": (
                        address.get("city")
                        or address.get("town")
                        or address.get("village")
                        or address.get("municipality")
                    ),
                    "source": "nominatim",
                }
            )
        _cache_put(_SUGGEST_CACHE, cache_key, suggestions)
        return [dict(item) for item in suggestions]

    @staticmethod
    def _approx_distance_m(origin: dict[str, Any], destination: dict[str, Any]) -> float:
        """Haversine approximate distance — used to avoid ORS alternative-route limits."""
        lat1, lon1 = float(origin["lat"]), float(origin["lon"])
        lat2, lon2 = float(destination["lat"]), float(destination["lon"])
        rlat1, rlon1, rlat2, rlon2 = map(math.radians, (lat1, lon1, lat2, lon2))
        dlat, dlon = rlat2 - rlat1, rlon2 - rlon1
        a = math.sin(dlat / 2) ** 2 + math.cos(rlat1) * math.cos(rlat2) * math.sin(dlon / 2) ** 2
        return 2 * 6_371_000 * math.asin(math.sqrt(a))

    @staticmethod
    def _midpoint(route: dict[str, Any]) -> tuple[float, float] | None:
        coords = (route.get("geometry") or {}).get("coordinates") or []
        if not coords:
            return None
        mid = coords[len(coords) // 2]
        return float(mid[0]), float(mid[1])

    @classmethod
    def _routes_are_similar(cls, a: dict[str, Any], b: dict[str, Any]) -> bool:
        """
        True when two routes are near-duplicates.

        Uses distance AND geometry midpoint so equal-length but geographically
        different alternatives are kept.
        """
        da = float(a.get("distance_m") or 0.0)
        db = float(b.get("distance_m") or 0.0)
        if da <= 0 or db <= 0:
            return False
        length_close = abs(da - db) / max(da, db) < 0.04

        ma, mb = cls._midpoint(a), cls._midpoint(b)
        if not ma or not mb:
            return length_close

        # ~1.5 km midpoint separation at equator ≈ 0.015 deg
        mid_close = abs(ma[0] - mb[0]) < 0.015 and abs(ma[1] - mb[1]) < 0.015
        return length_close and mid_close

    def _merge_distinct_routes(
        self,
        batches: list[list[dict[str, Any]]],
        *,
        max_alternatives: int,
    ) -> list[dict[str, Any]]:
        merged: list[dict[str, Any]] = []
        for batch in batches:
            for route in batch:
                if len(merged) >= max_alternatives:
                    break
                if any(self._routes_are_similar(route, existing) for existing in merged):
                    continue
                merged.append(route)
            if len(merged) >= max_alternatives:
                break
        for idx, route in enumerate(merged):
            route["alternative_index"] = idx
        return merged

    @staticmethod
    def _offset_via(
        origin: dict[str, Any],
        destination: dict[str, Any],
        *,
        side: float,
        along: float = 0.5,
    ) -> dict[str, float]:
        """
        Build a via point offset from the OD chord to force an alternate path.

        side: +1 / -1 for left/right of travel direction (degrees-ish scaled by trip length).
        """
        lat1, lon1 = float(origin["lat"]), float(origin["lon"])
        lat2, lon2 = float(destination["lat"]), float(destination["lon"])
        mid_lat = lat1 + (lat2 - lat1) * along
        mid_lon = lon1 + (lon2 - lon1) * along
        # Perpendicular unit vector in lon/lat space (approx).
        dlat, dlon = lat2 - lat1, lon2 - lon1
        length = math.hypot(dlat, dlon) or 1.0
        # Offset ~8–12% of chord length, clamped.
        offset = min(0.08, max(0.015, length * 0.12)) * side
        plat = -dlon / length
        plon = dlat / length
        return {
            "lat": mid_lat + plat * offset,
            "lon": mid_lon + plon * offset,
        }

    def fetch_routes(
        self,
        origin: dict[str, Any],
        destination: dict[str, Any],
        *,
        max_alternatives: int = 3,
    ) -> list[dict[str, Any]]:
        """
        Request up to three genuinely distinct route alternatives.

        Strategy (stop early once we have enough distinct geometries):
        1. OSRM with numeric alternatives
        2. ORS alternative_routes (short trips only)
        3. ORS preferences: recommended / fastest / shortest × profiles
        4. OSRM/ORS via-point detours to force remaining distinct paths
        """
        approx_m = self._approx_distance_m(origin, destination)
        # ORS public alternative-routes limit is 100_000 m.
        ors_alts_ok = approx_m < 95_000 and max_alternatives > 1
        last_error: Exception | None = None
        batches: list[list[dict[str, Any]]] = []

        def merged_count() -> int:
            return len(self._merge_distinct_routes(batches, max_alternatives=max_alternatives))

        body_base: dict[str, Any] = {
            "coordinates": [
                [origin["lon"], origin["lat"]],
                [destination["lon"], destination["lat"]],
            ],
            "instructions": False,
            "geometry": True,
            "elevation": False,
            "units": "m",
        }

        profiles = [self.profile]
        if self.profile != "driving-car":
            profiles.append("driving-car")

        # 1) OSRM alternatives (works beyond ORS 100 km alt limit)
        if max_alternatives > 1:
            try:
                osrm = self._directions_osrm(
                    origin, destination, max_alternatives=max_alternatives
                )
                if osrm:
                    batches.append(osrm)
            except RoutingError as exc:
                last_error = exc
                logger.warning("OSRM routing failed: %s", exc.message)

        # 2) ORS with alternative_routes (up to 2 alts → 3 routes on short trips)
        if ors_alts_ok and merged_count() < max_alternatives:
            alt_count = max(0, max_alternatives - 1)
            body_with_alts = {
                **body_base,
                "alternative_routes": {
                    "target_count": min(alt_count, 2),
                    "share_factor": 0.4,
                    "weight_factor": 1.8,
                },
            }
            for profile in profiles:
                try:
                    ors_routes = self._directions(profile, body_with_alts)
                    if ors_routes:
                        batches.append(ors_routes)
                        break
                except RoutingError as exc:
                    last_error = exc
                    logger.warning(
                        "ORS alternatives with profile %s failed: %s",
                        profile,
                        exc.message,
                    )

        # 3) ORS preference variants (often yields different geometries)
        if merged_count() < max_alternatives:
            for preference in ("recommended", "fastest", "shortest"):
                if merged_count() >= max_alternatives:
                    break
                for profile in profiles:
                    if merged_count() >= max_alternatives:
                        break
                    body = {**body_base, "preference": preference}
                    try:
                        routes = self._directions(profile, body)
                        if routes:
                            batches.append(routes)
                    except RoutingError as exc:
                        last_error = exc
                        logger.warning(
                            "ORS preference=%s profile=%s failed: %s",
                            preference,
                            profile,
                            exc.message,
                        )

        # 4) Via-point detours to force remaining alternatives
        if merged_count() < max_alternatives:
            for side in (1.0, -1.0, 1.4, -1.4):
                if merged_count() >= max_alternatives:
                    break
                via = self._offset_via(origin, destination, side=side)
                try:
                    detour = self._directions_osrm_via(
                        origin, via, destination, max_alternatives=1
                    )
                    if detour:
                        batches.append(detour)
                        continue
                except RoutingError as exc:
                    last_error = exc
                for profile in profiles[:1]:
                    try:
                        body = {
                            **body_base,
                            "coordinates": [
                                [origin["lon"], origin["lat"]],
                                [via["lon"], via["lat"]],
                                [destination["lon"], destination["lat"]],
                            ],
                        }
                        routes = self._directions(profile, body)
                        if routes:
                            batches.append(routes)
                            break
                    except RoutingError as exc:
                        last_error = exc
                        logger.warning("ORS via-detour failed: %s", exc.message)

        merged = self._merge_distinct_routes(batches, max_alternatives=max_alternatives)
        if merged:
            logger.info(
                "Returning %s distinct route(s) from %s provider batch(es)",
                len(merged),
                len(batches),
            )
            return merged[:max_alternatives]

        raise RoutingError(
            str(last_error) if last_error else "Unable to fetch routes from routing providers."
        )

    def _directions_osrm(
        self,
        origin: dict[str, Any],
        destination: dict[str, Any],
        *,
        max_alternatives: int = 3,
    ) -> list[dict[str, Any]]:
        """OSRM public demo server — used when ORS is down or for alternatives."""
        coords = f"{origin['lon']},{origin['lat']};{destination['lon']},{destination['lat']}"
        url = f"https://router.project-osrm.org/route/v1/driving/{coords}"
        # Numeric alternatives asks OSRM for up to N-1 extra routes (total ≈ N).
        alt_param: str | int = max(0, max_alternatives - 1) if max_alternatives > 1 else "false"
        try:
            response = requests.get(
                url,
                params={
                    "overview": "full",
                    "geometries": "geojson",
                    "alternatives": alt_param,
                },
                timeout=self.timeout,
            )
        except requests.RequestException as exc:
            raise RoutingError(f"OSRM routing request failed: {exc}") from exc

        if response.status_code >= 400:
            raise RoutingError(
                f"OSRM routing API error ({response.status_code}): {response.text[:300]}",
                status=502,
            )

        payload = response.json()
        if payload.get("code") != "Ok":
            raise RoutingError(f"OSRM routing failed: {payload.get('code')}")

        return self._parse_osrm_routes(payload, max_alternatives=max_alternatives)

    def _directions_osrm_via(
        self,
        origin: dict[str, Any],
        via: dict[str, float],
        destination: dict[str, Any],
        *,
        max_alternatives: int = 1,
    ) -> list[dict[str, Any]]:
        coords = (
            f"{origin['lon']},{origin['lat']};"
            f"{via['lon']},{via['lat']};"
            f"{destination['lon']},{destination['lat']}"
        )
        url = f"https://router.project-osrm.org/route/v1/driving/{coords}"
        try:
            response = requests.get(
                url,
                params={
                    "overview": "full",
                    "geometries": "geojson",
                    "alternatives": "false",
                },
                timeout=self.timeout,
            )
        except requests.RequestException as exc:
            raise RoutingError(f"OSRM via routing request failed: {exc}") from exc

        if response.status_code >= 400:
            raise RoutingError(
                f"OSRM via routing API error ({response.status_code}): {response.text[:300]}",
                status=502,
            )

        payload = response.json()
        if payload.get("code") != "Ok":
            raise RoutingError(f"OSRM via routing failed: {payload.get('code')}")

        return self._parse_osrm_routes(payload, max_alternatives=max_alternatives)

    def _parse_osrm_routes(
        self,
        payload: dict[str, Any],
        *,
        max_alternatives: int,
    ) -> list[dict[str, Any]]:
        routes: list[dict[str, Any]] = []
        for idx, route in enumerate((payload.get("routes") or [])[:max_alternatives]):
            geometry = route.get("geometry") or {}
            coords_list = geometry.get("coordinates") or []
            if not coords_list:
                continue
            distance_m = float(route.get("distance") or 0.0)
            duration_s = float(route.get("duration") or 0.0)
            route_id = f"osrm-driving-{uuid.uuid4().hex[:12]}"
            routes.append(
                {
                    "id": route_id,
                    "provider": "osrm",
                    "profile": "driving",
                    "alternative_index": idx,
                    "geometry": {
                        "type": "LineString",
                        "coordinates": coords_list,
                    },
                    "distance_m": distance_m,
                    "distance_miles": round(distance_m / 1609.344, 3),
                    "duration_seconds": duration_s,
                    "duration_minutes": round(duration_s / 60.0, 1),
                }
            )

        if not routes:
            raise RoutingError("OSRM returned no usable routes.")
        return routes

    def _directions(self, profile: str, body: dict[str, Any]) -> list[dict[str, Any]]:
        url = f"{self.base}/v2/directions/{profile}/geojson"
        # Short ORS timeout — free tier is often slow/unstable; fall back quickly.
        ors_timeout = min(self.timeout, 15)
        try:
            response = requests.post(
                url,
                json=body,
                headers=self._headers(),
                timeout=ors_timeout,
            )
        except requests.RequestException as exc:
            raise RoutingError(f"Routing request failed: {exc}") from exc

        if response.status_code == 429:
            raise RoutingError("Routing rate limit exceeded. Try again shortly.", status=429)
        if response.status_code >= 400:
            raise RoutingError(
                f"Routing API error ({response.status_code}): {response.text[:400]}",
                status=502,
            )

        payload = response.json()
        features = payload.get("features") or []
        if not features:
            raise RoutingError("Routing API returned no route features.")

        routes: list[dict[str, Any]] = []
        for idx, feature in enumerate(features):
            props = feature.get("properties") or {}
            summary = props.get("summary") or {}
            segments = props.get("segments") or []
            # Prefer summary; fall back to summing segments
            distance_m = float(summary.get("distance") or 0.0)
            duration_s = float(summary.get("duration") or 0.0)
            if (not distance_m or not duration_s) and segments:
                distance_m = sum(float(s.get("distance") or 0) for s in segments)
                duration_s = sum(float(s.get("duration") or 0) for s in segments)

            geometry = feature.get("geometry") or {}
            coords = geometry.get("coordinates") or []
            if not coords:
                continue

            route_id = f"ors-{profile}-{uuid.uuid4().hex[:12]}"
            routes.append(
                {
                    "id": route_id,
                    "provider": "openrouteservice",
                    "profile": profile,
                    "alternative_index": idx,
                    "geometry": {
                        "type": "LineString",
                        "coordinates": coords,  # [lon, lat]
                    },
                    "distance_m": distance_m,
                    "distance_miles": round(distance_m / 1609.344, 3),
                    "duration_seconds": duration_s,
                    "duration_minutes": round(duration_s / 60.0, 1),
                }
            )

        if not routes:
            raise RoutingError("All returned routes lacked usable geometry.")
        return routes


def get_routing_service() -> RoutingService:
    return RoutingService()
