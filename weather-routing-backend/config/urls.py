from django.http import JsonResponse
from django.urls import include, path
from drf_spectacular.views import SpectacularAPIView, SpectacularRedocView, SpectacularSwaggerView


def root(_request):
    return JsonResponse(
        {
            "service": "weather-aware-truck-routing",
            "message": "Interactive docs are at /docs/. API is under /api/.",
            "docs": {
                "swagger_ui": "/docs/",
                "redoc": "/redoc/",
                "openapi_schema": "/api/schema/",
            },
            "endpoints": {
                "health": "/api/health/",
                "analyze_routes": "POST /api/routes/analyze/",
                "route_detail": "GET /api/routes/<route_id>/",
                "weather_forecast": "GET|POST /api/weather/forecast/",
            },
        }
    )


urlpatterns = [
    path("", root, name="root"),
    path("api/schema/", SpectacularAPIView.as_view(), name="schema"),
    path(
        "docs/",
        SpectacularSwaggerView.as_view(url_name="schema"),
        name="swagger-ui",
    ),
    path(
        "docs",
        SpectacularSwaggerView.as_view(url_name="schema"),
        name="swagger-ui-noslash",
    ),
    path(
        "redoc/",
        SpectacularRedocView.as_view(url_name="schema"),
        name="redoc",
    ),
    path("api/", include("planner.urls")),
]
