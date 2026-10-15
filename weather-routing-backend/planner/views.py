"""Planning and health API views."""

from __future__ import annotations

import logging
from datetime import timezone

from drf_spectacular.utils import OpenApiParameter, OpenApiResponse, extend_schema
from rest_framework import status
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from config.exception_handler import public_message
from planner.serializers import (
    AnalyzeRoutesSerializer,
    PlaceReverseQuerySerializer,
    PlaceSuggestQuerySerializer,
    WeatherForecastQuerySerializer,
)
from planner.services import get_trip_planner
from planner.store import get_route_store
from routing.services import get_routing_service
from shared.exceptions import RouteNotFoundError, WeatherRoutingError
from weather.services import get_weather_service

logger = logging.getLogger(__name__)


def _error_response(exc: WeatherRoutingError) -> Response:
    # Views catch WeatherRoutingError locally (for request-specific context),
    # but must still go through the same public_message() translator as the
    # global DRF exception handler — otherwise a raw provider/network error
    # (e.g. a `requests` exception repr) could reach the client here. Full
    # technical detail is logged server-side only.
    if exc.status >= 500:
        logger.warning("%s: %s", exc.code, exc.message)
    return Response(
        {"error": {"code": exc.code, "message": public_message(exc)}},
        status=exc.status,
    )


class HealthView(APIView):
    authentication_classes: list = []
    permission_classes: list = []

    @extend_schema(
        tags=["health"],
        summary="Health check",
        description="Returns backend health status.",
        responses={200: OpenApiResponse(description="Service is healthy")},
    )
    def get(self, request: Request) -> Response:
        return Response(
            {
                "status": "ok",
                "service": "weather-aware-truck-routing",
                "version": "1.0.0",
            }
        )


class AnalyzeRoutesView(APIView):
    authentication_classes: list = []
    permission_classes: list = []

    @extend_schema(
        tags=["routes"],
        summary="Analyze trip routes",
        description=(
            "Geocode origin/destination, fetch up to three route alternatives, "
            "sample weather at checkpoints, apply risk rules, and recommend a route."
        ),
        request=AnalyzeRoutesSerializer,
        responses={200: OpenApiResponse(description="Analyzed routes and recommendation")},
    )
    def post(self, request: Request) -> Response:
        serializer = AnalyzeRoutesSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        departure = data["departure"]
        if departure.tzinfo is None:
            departure = departure.replace(tzinfo=timezone.utc)

        try:
            result = get_trip_planner().analyze_trip(
                origin=data["origin"],
                destination=data["destination"],
                departure=departure,
                load_weight_lb=data["load_weight_lb"],
                checkpoint_interval_miles=data.get("checkpoint_interval_miles"),
                include_heatmap_points=data.get("include_heatmap_points", False),
            )
        except WeatherRoutingError as exc:
            return _error_response(exc)

        # Clean None warnings on routes
        for route in result.get("routes", []):
            route["warnings"] = [w for w in (route.get("warnings") or []) if w]

        return Response(result, status=status.HTTP_200_OK)


class RouteDetailView(APIView):
    authentication_classes: list = []
    permission_classes: list = []

    @extend_schema(
        tags=["routes"],
        summary="Get cached route details",
        description="Returns a route previously produced by /api/routes/analyze/ (in-memory cache).",
        responses={
            200: OpenApiResponse(description="Route details"),
            404: OpenApiResponse(description="Route not found in cache"),
        },
    )
    def get(self, request: Request, route_id: str) -> Response:
        route = get_route_store().get(route_id)
        if route is None:
            return _error_response(
                RouteNotFoundError(
                    f"Route '{route_id}' was not found. Analyze a trip first; "
                    "routes are cached in-memory for this process only."
                )
            )
        return Response(route)


class WeatherForecastView(APIView):
    """
    Heatmap-oriented forecast endpoint.

    Query params for a single point:
      ?lat=&lon=&hours=48&step_hours=1&start=

    Or JSON body with points: [{"lat":..,"lon":..}, ...]
    """

    authentication_classes: list = []
    permission_classes: list = []

    @extend_schema(
        tags=["weather"],
        summary="Weather forecast for heatmap",
        description="0–48 hour forecast for a coordinate (query params) used by the trip heatmap.",
        parameters=[
            OpenApiParameter(name="lat", type=float, required=True, location=OpenApiParameter.QUERY),
            OpenApiParameter(name="lon", type=float, required=True, location=OpenApiParameter.QUERY),
            OpenApiParameter(name="hours", type=int, required=False, location=OpenApiParameter.QUERY),
            OpenApiParameter(name="step_hours", type=int, required=False, location=OpenApiParameter.QUERY),
            OpenApiParameter(name="start", type=str, required=False, location=OpenApiParameter.QUERY),
        ],
        responses={200: OpenApiResponse(description="Forecast frames")},
    )
    def get(self, request: Request) -> Response:
        payload = {
            "lat": request.query_params.get("lat"),
            "lon": request.query_params.get("lon"),
            "start": request.query_params.get("start"),
            "hours": request.query_params.get("hours", 48),
            "step_hours": request.query_params.get("step_hours", 1),
        }
        # Drop empty optional start
        if not payload["start"]:
            payload.pop("start")

        serializer = WeatherForecastQuerySerializer(data=payload)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        points = data.get("points") or [{"lat": data["lat"], "lon": data["lon"]}]
        start = data.get("start")
        if start is not None and start.tzinfo is None:
            start = start.replace(tzinfo=timezone.utc)

        try:
            forecast = get_weather_service().corridor_forecast(
                points,
                start=start,
                hours=data.get("hours", 48),
                step_hours=data.get("step_hours", 1),
            )
        except WeatherRoutingError as exc:
            return _error_response(exc)

        return Response(forecast)

    @extend_schema(
        tags=["weather"],
        summary="Corridor weather forecast",
        description="Forecast for multiple corridor points (JSON body) for denser heatmap requests.",
        request=WeatherForecastQuerySerializer,
        responses={200: OpenApiResponse(description="Forecast frames")},
    )
    def post(self, request: Request) -> Response:
        """Accept corridor points in the body for denser heatmap requests."""
        serializer = WeatherForecastQuerySerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        if data.get("points"):
            points = data["points"]
        elif "lat" in data and "lon" in data:
            points = [{"lat": data["lat"], "lon": data["lon"]}]
        else:
            return Response(
                {
                    "error": {
                        "code": "validation_error",
                        "message": "Provide lat/lon or a points list.",
                    }
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        start = data.get("start")
        if start is not None and start.tzinfo is None:
            start = start.replace(tzinfo=timezone.utc)

        try:
            forecast = get_weather_service().corridor_forecast(
                points,
                start=start,
                hours=data.get("hours", 48),
                step_hours=data.get("step_hours", 1),
            )
        except WeatherRoutingError as exc:
            return _error_response(exc)

        return Response(forecast)


class PlaceSuggestView(APIView):
    """Autocomplete places for origin/destination inputs (Nominatim, no API key)."""

    authentication_classes: list = []
    permission_classes: list = []

    @extend_schema(
        tags=["places"],
        summary="Place autocomplete",
        description="Suggest cities, regions, and countries matching a partial query.",
        parameters=[
            OpenApiParameter(name="q", type=str, required=True, location=OpenApiParameter.QUERY),
            OpenApiParameter(name="limit", type=int, required=False, location=OpenApiParameter.QUERY),
        ],
        responses={200: OpenApiResponse(description="Suggestion list")},
    )
    def get(self, request: Request) -> Response:
        serializer = PlaceSuggestQuerySerializer(data=request.query_params)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        try:
            result = get_routing_service().suggest_places(
                data["q"],
                limit=data.get("limit", 6),
            )
        except WeatherRoutingError as exc:
            # Provider outage / rate limit: surface an honest error, never an empty
            # or fabricated suggestion list.
            return _error_response(exc)
        response = Response(
            {
                "query": data["q"],
                "suggestions": result["suggestions"],
                "provider": result["provider"],
                "cached": result["cached"],
            }
        )
        response["Cache-Control"] = "no-store"
        return response


class PlaceReverseView(APIView):
    """Reverse-geocode the user's browser coordinates into a place label."""

    authentication_classes: list = []
    permission_classes: list = []

    @extend_schema(
        tags=["places"],
        summary="Reverse geocode",
        description="Turn lat/lon into a human-readable place for the trip origin.",
        parameters=[
            OpenApiParameter(name="lat", type=float, required=True, location=OpenApiParameter.QUERY),
            OpenApiParameter(name="lon", type=float, required=True, location=OpenApiParameter.QUERY),
        ],
        responses={200: OpenApiResponse(description="Resolved place")},
    )
    def get(self, request: Request) -> Response:
        serializer = PlaceReverseQuerySerializer(data=request.query_params)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        try:
            place = get_routing_service().reverse_geocode(data["lat"], data["lon"])
        except WeatherRoutingError as exc:
            return _error_response(exc)
        return Response(place)
