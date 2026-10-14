"""Application-level exceptions with HTTP-friendly metadata."""


class WeatherRoutingError(Exception):
    """Base application error."""

    default_code = "error"
    default_status = 500

    def __init__(self, message: str, *, code: str | None = None, status: int | None = None):
        super().__init__(message)
        self.message = message
        self.code = code or self.default_code
        self.status = status or self.default_status


class ValidationAppError(WeatherRoutingError):
    default_code = "validation_error"
    default_status = 400


class GeocodingError(WeatherRoutingError):
    default_code = "geocoding_error"
    default_status = 502


class RoutingError(WeatherRoutingError):
    default_code = "routing_error"
    default_status = 502


class WeatherProviderError(WeatherRoutingError):
    default_code = "weather_error"
    default_status = 502


class ExternalServiceError(WeatherRoutingError):
    default_code = "external_service_error"
    default_status = 502


class RouteNotFoundError(WeatherRoutingError):
    default_code = "route_not_found"
    default_status = 404
