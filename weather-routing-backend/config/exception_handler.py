"""Consistent JSON error responses for DRF validation and app errors."""

from __future__ import annotations

import logging

from rest_framework.response import Response
from rest_framework.views import exception_handler

from shared.exceptions import (
    GeocodingError,
    LocationServiceRateLimitedError,
    LocationServiceUnavailableError,
    RouteNotFoundError,
    RoutingError,
    ValidationAppError,
    WeatherProviderError,
    WeatherRoutingError,
)

logger = logging.getLogger(__name__)


def public_message(exc: WeatherRoutingError) -> str:
    """
    Translate an internal app exception into clean, user-facing copy.

    This is the SINGLE source of truth for turning WeatherRoutingError
    subclasses into text shown in the UI. It is used both by this DRF-level
    handler (for exceptions that bubble up uncaught) and directly by view
    code that catches these exceptions locally (see planner/views.py) — so a
    raw provider/network error message (e.g. a `requests` exception repr)
    can never reach the client from either path.
    """
    if isinstance(exc, ValidationAppError):
        return "Please check the origin, destination, and departure time, then try again."
    if isinstance(exc, LocationServiceRateLimitedError):
        return (
            "The location search service is rate-limited right now. "
            "Wait a few seconds and try again."
        )
    if isinstance(exc, LocationServiceUnavailableError):
        return (
            "The location search service is unavailable right now, so no results "
            "can be shown. Please try again shortly."
        )
    if isinstance(exc, GeocodingError):
        # Allowlist the specific, hand-written "not found" / rate-limit messages
        # (helpful: they name the place that failed to resolve). Everything else
        # (provider HTTP errors, raw `requests` exception text, nested fallback
        # errors re-wrapped via GeocodingError(str(other_exc))) falls back to a
        # generic message rather than risk leaking technical text to the client.
        msg = exc.message
        if msg.startswith("No results found for") or msg.startswith(
            "Geocoding rate limit exceeded"
        ):
            return msg
        return "We could not look up one of the locations right now. Please try again."
    if isinstance(exc, RoutingError):
        return "We could not calculate routes for this trip. Try different locations or try again."
    if isinstance(exc, WeatherProviderError):
        return "Weather data is temporarily unavailable. Please try again shortly."
    if isinstance(exc, RouteNotFoundError):
        # Always a hand-written, safe message naming the route id and explaining
        # the in-memory cache — never built from a raw provider/exception string.
        return exc.message
    return "Unable to complete this request. Please try again."


def custom_exception_handler(exc, context):
    if isinstance(exc, WeatherRoutingError):
        return Response(
            {"error": {"code": exc.code, "message": public_message(exc)}},
            status=exc.status,
        )

    response = exception_handler(exc, context)
    if response is not None:
        response.data = {
            "error": {
                "code": "validation_error" if response.status_code == 400 else "error",
                "message": "Request failed",
                "details": response.data,
            }
        }
        return response

    # DRF's default handler returns None for exceptions it doesn't recognize
    # (e.g. an unexpected bug), which would otherwise fall through to Django's
    # own error handling and, with DEBUG=True, render a full technical
    # traceback page to the client. Log the real error server-side and always
    # return a clean, generic JSON error instead.
    logger.exception("Unhandled exception in API view: %s", exc)
    return Response(
        {
            "error": {
                "code": "internal_error",
                "message": "Unable to complete this request. Please try again.",
            }
        },
        status=500,
    )
