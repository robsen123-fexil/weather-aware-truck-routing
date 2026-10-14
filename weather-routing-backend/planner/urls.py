from django.urls import path

from planner.views import (
    AnalyzeRoutesView,
    HealthView,
    PlaceReverseView,
    PlaceSuggestView,
    RouteDetailView,
    WeatherForecastView,
)

urlpatterns = [
    path("health/", HealthView.as_view(), name="health"),
    path("places/suggest/", PlaceSuggestView.as_view(), name="places-suggest"),
    path("places/reverse/", PlaceReverseView.as_view(), name="places-reverse"),
    path("routes/analyze/", AnalyzeRoutesView.as_view(), name="routes-analyze"),
    path("routes/<str:route_id>/", RouteDetailView.as_view(), name="route-detail"),
    path("weather/forecast/", WeatherForecastView.as_view(), name="weather-forecast"),
]
