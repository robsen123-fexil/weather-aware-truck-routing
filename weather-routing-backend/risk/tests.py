from django.test import SimpleTestCase

from recommendations.ranker import rank_routes, select_recommendation
from risk.calculator import WeatherMeasurements, calculate_checkpoint_risk
from risk.rules import apply_load_adjustments, classify_rain, classify_snow, classify_wind
from risk.scoring import summarize_route_risk
from shared.constants import RiskLevel


class WindRulesTests(SimpleTestCase):
    def test_wind_thresholds(self):
        self.assertEqual(classify_wind(24.9), RiskLevel.LOW)
        self.assertEqual(classify_wind(25), RiskLevel.MODERATE)
        self.assertEqual(classify_wind(34), RiskLevel.MODERATE)
        self.assertEqual(classify_wind(35), RiskLevel.HIGH)
        self.assertEqual(classify_wind(44), RiskLevel.HIGH)
        self.assertEqual(classify_wind(45), RiskLevel.SEVERE)
        self.assertEqual(classify_wind(54), RiskLevel.SEVERE)
        self.assertEqual(classify_wind(55), RiskLevel.NO_TRAVEL)


class RainSnowRulesTests(SimpleTestCase):
    def test_rain_thresholds(self):
        self.assertEqual(classify_rain(0.09), RiskLevel.LOW)
        self.assertEqual(classify_rain(0.10), RiskLevel.MODERATE)
        self.assertEqual(classify_rain(0.24), RiskLevel.MODERATE)
        self.assertEqual(classify_rain(0.25), RiskLevel.HIGH)
        self.assertEqual(classify_rain(0.49), RiskLevel.HIGH)
        self.assertEqual(classify_rain(0.50), RiskLevel.SEVERE)
        self.assertEqual(classify_rain(1.00), RiskLevel.SEVERE)
        self.assertEqual(classify_rain(1.01), RiskLevel.NO_TRAVEL)

    def test_snow_thresholds(self):
        self.assertEqual(classify_snow(0.49), RiskLevel.LOW)
        self.assertEqual(classify_snow(0.5), RiskLevel.MODERATE)
        self.assertEqual(classify_snow(0.99), RiskLevel.MODERATE)
        self.assertEqual(classify_snow(1.0), RiskLevel.HIGH)
        self.assertEqual(classify_snow(1.99), RiskLevel.HIGH)
        self.assertEqual(classify_snow(2.0), RiskLevel.SEVERE)
        self.assertEqual(classify_snow(3.0), RiskLevel.SEVERE)
        self.assertEqual(classify_snow(3.01), RiskLevel.NO_TRAVEL)


class LoadAdjustmentTests(SimpleTestCase):
    def test_load_rules(self):
        self.assertEqual(
            apply_load_adjustments(55, 1000, RiskLevel.NO_TRAVEL),
            RiskLevel.NO_TRAVEL,
        )
        self.assertEqual(
            apply_load_adjustments(50, 30_001, RiskLevel.SEVERE),
            RiskLevel.NO_TRAVEL,
        )
        self.assertEqual(
            apply_load_adjustments(50, 30_000, RiskLevel.SEVERE),
            RiskLevel.SEVERE,
        )
        self.assertEqual(
            apply_load_adjustments(40, 40_001, RiskLevel.HIGH),
            RiskLevel.SEVERE,
        )
        self.assertEqual(
            apply_load_adjustments(40, 40_000, RiskLevel.HIGH),
            RiskLevel.HIGH,
        )


class OverallRiskTests(SimpleTestCase):
    def test_max_of_conditions(self):
        wx = WeatherMeasurements(wind_mph=20, rain_in_hr=0.3, snow_in_hr=0.1)
        risk = calculate_checkpoint_risk(wx, load_lb=10_000)
        self.assertEqual(risk.overall_risk, "High")

    def test_heavy_load_high_wind(self):
        wx = WeatherMeasurements(wind_mph=40, rain_in_hr=0.0, snow_in_hr=0.0)
        risk = calculate_checkpoint_risk(wx, load_lb=45_000)
        self.assertEqual(risk.overall_risk, "Severe")
        self.assertTrue(risk.load_adjusted)

    def test_unavailable_not_assumed_low(self):
        wx = WeatherMeasurements(
            wind_mph=None,
            rain_in_hr=None,
            snow_in_hr=None,
            available=False,
            notes="missing",
        )
        risk = calculate_checkpoint_risk(wx, load_lb=10_000)
        self.assertEqual(risk.overall_risk, "Unavailable")
        self.assertEqual(risk.overall_risk_driver, "unavailable")
        self.assertFalse(risk.evaluated)


class ScoringAndRankingTests(SimpleTestCase):
    def test_risk_miles_and_recommendation(self):
        checkpoints = [
            {
                "distance_from_origin_miles": 0,
                "weather": {"available": True},
                "risk": {"overall_risk": "Low", "evaluated": True},
            },
            {
                "distance_from_origin_miles": 25,
                "weather": {"available": True},
                "risk": {"overall_risk": "Severe", "evaluated": True},
                "coordinates": {"lat": 1, "lon": 2},
                "eta": "2026-01-01T12:00:00+00:00",
            },
            {
                "distance_from_origin_miles": 50,
                "weather": {"available": True},
                "risk": {"overall_risk": "High", "evaluated": True},
            },
        ]
        summary = summarize_route_risk(checkpoints)
        self.assertEqual(summary.severe_miles, 25.0)
        self.assertEqual(summary.high_miles, 25.0)
        self.assertEqual(summary.forecast_coverage["coverage_percent"], 100.0)

    def test_unavailable_miles_not_counted_as_low(self):
        checkpoints = [
            {
                "distance_from_origin_miles": 0,
                "weather": {"available": True},
                "risk": {"overall_risk": "Low", "evaluated": True},
            },
            {
                "distance_from_origin_miles": 25,
                "weather": {"available": False},
                "risk": {"overall_risk": "Unavailable", "evaluated": False},
            },
        ]
        summary = summarize_route_risk(checkpoints)
        self.assertEqual(summary.unavailable_miles, 25.0)
        self.assertEqual(summary.low_miles, 0.0)
        self.assertTrue(summary.has_incomplete_forecast)

    def test_ranking_prefers_fewer_severe(self):
        routes = [
            {
                "id": "a",
                "duration_seconds": 1000,
                "risk_summary": {
                    "severe_miles": 10,
                    "high_miles": 5,
                    "average_risk": 1.0,
                    "has_no_travel": False,
                    "forecast_coverage": {"coverage_percent": 100},
                },
            },
            {
                "id": "b",
                "duration_seconds": 900,
                "risk_summary": {
                    "severe_miles": 5,
                    "high_miles": 20,
                    "average_risk": 1.5,
                    "has_no_travel": False,
                    "forecast_coverage": {"coverage_percent": 100},
                },
            },
            {
                "id": "c",
                "duration_seconds": 500,
                "risk_summary": {
                    "severe_miles": 0,
                    "high_miles": 0,
                    "average_risk": 0.1,
                    "has_no_travel": True,
                    "forecast_coverage": {"coverage_percent": 100},
                },
            },
        ]
        ranked = rank_routes(routes)
        self.assertEqual(ranked[0]["id"], "b")
        recommended = select_recommendation(ranked)
        self.assertEqual(recommended["id"], "b")
