"""Request validation for trip planning APIs."""

from __future__ import annotations

from rest_framework import serializers

from shared.constants import CHECKPOINT_INTERVALS_MILES


class PlaceSuggestQuerySerializer(serializers.Serializer):
    q = serializers.CharField(max_length=200, allow_blank=False)
    limit = serializers.IntegerField(required=False, min_value=1, max_value=10, default=6)

    def validate_q(self, value: str) -> str:
        value = value.strip()
        if not value:
            raise serializers.ValidationError("Query is required.")
        return value


class PlaceReverseQuerySerializer(serializers.Serializer):
    lat = serializers.FloatField(min_value=-90, max_value=90)
    lon = serializers.FloatField(min_value=-180, max_value=180)


class AnalyzeRoutesSerializer(serializers.Serializer):
    origin = serializers.CharField(max_length=512)
    destination = serializers.CharField(max_length=512)
    departure = serializers.DateTimeField(
        help_text="ISO-8601 departure date/time. Naive values are treated as UTC."
    )
    load_weight_lb = serializers.FloatField(min_value=0)
    checkpoint_interval_miles = serializers.ChoiceField(
        choices=CHECKPOINT_INTERVALS_MILES,
        required=False,
        default=25,
    )
    include_heatmap_points = serializers.BooleanField(required=False, default=False)

    def validate_origin(self, value: str) -> str:
        value = value.strip()
        if not value:
            raise serializers.ValidationError("Origin is required.")
        return value

    def validate_destination(self, value: str) -> str:
        value = value.strip()
        if not value:
            raise serializers.ValidationError("Destination is required.")
        return value


class WeatherForecastQuerySerializer(serializers.Serializer):
    lat = serializers.FloatField(min_value=-90, max_value=90, required=False)
    lon = serializers.FloatField(min_value=-180, max_value=180, required=False)
    start = serializers.DateTimeField(required=False)
    hours = serializers.IntegerField(required=False, min_value=0, max_value=48, default=48)
    step_hours = serializers.IntegerField(required=False, min_value=1, max_value=6, default=3)
    points = serializers.ListField(
        child=serializers.DictField(),
        required=False,
        allow_empty=False,
    )

    def validate_points(self, value):
        cleaned = []
        for pt in value:
            if "lat" not in pt or "lon" not in pt:
                raise serializers.ValidationError("Each point requires lat and lon.")
            cleaned.append({"lat": float(pt["lat"]), "lon": float(pt["lon"])})
        return cleaned

    def validate(self, attrs):
        has_point = "lat" in attrs and "lon" in attrs
        has_points = bool(attrs.get("points"))
        if not has_point and not has_points:
            raise serializers.ValidationError("Provide lat/lon or a points list.")
        return attrs
