from datetime import datetime, timezone
from unittest import mock

import requests
from django.test import SimpleTestCase, override_settings
from rest_framework.test import APIClient

from routing import services as routing_services
from routing.checkpoints import generate_checkpoints
from routing.eta import attach_etas


class CheckpointTests(SimpleTestCase):
    def test_interval_and_destination(self):
        geometry = [
            [-87.0, 41.0],
            [-86.0, 41.0],
        ]
        cps = generate_checkpoints(geometry, interval_miles=25)
        self.assertEqual(cps[0]["distance_from_origin_miles"], 0)
        self.assertTrue(cps[0]["is_origin"])
        self.assertTrue(cps[-1]["is_destination"])
        self.assertGreaterEqual(len(cps), 2)

    def test_etas_scale_with_distance(self):
        cps = [
            {"distance_from_origin_m": 0},
            {"distance_from_origin_m": 50_000},
            {"distance_from_origin_m": 100_000},
        ]
        departure = datetime(2026, 6, 1, 12, 0, tzinfo=timezone.utc)
        result = attach_etas(
            cps,
            departure=departure,
            duration_seconds=3600,
            total_distance_m=100_000,
        )
        self.assertEqual(result[0]["eta_offset_seconds"], 0)
        self.assertEqual(result[1]["eta_offset_seconds"], 1800)
        self.assertEqual(result[2]["eta_offset_seconds"], 3600)


def _resp(status: int, payload):
    r = mock.Mock()
    r.status_code = status
    r.json.return_value = payload
    r.text = ""
    return r


ORS_OK = {
    "features": [
        {
            "geometry": {"coordinates": [39.27, 21.50]},
            "properties": {"label": "Jeddah, Saudi Arabia", "layer": "locality", "gid": "g1"},
        }
    ]
}
NOMINATIM_OK = [
    {
        "display_name": "Jeddah, Makkah, Saudi Arabia",
        "lat": "21.5",
        "lon": "39.2",
        "osm_type": "relation",
        "osm_id": 42,
        "type": "city",
        "address": {"country": "Saudi Arabia"},
    }
]


@override_settings(OPENROUTESERVICE_API_KEY="test-key")
class SuggestPlacesTests(SimpleTestCase):
    """Mocks here are test-only; production code never ships fabricated places."""

    def setUp(self):
        routing_services._SUGGEST_CACHE.clear()
        self.client = APIClient()

    def _get(self, q="Jeddah"):
        return self.client.get("/api/places/suggest/", {"q": q})

    def test_results_come_from_provider_with_id_and_no_store(self):
        with mock.patch("routing.services.requests.get", return_value=_resp(200, ORS_OK)) as get:
            res = self._get("Jeddah")
        self.assertEqual(res.status_code, 200)
        body = res.json()
        self.assertEqual(body["provider"], "openrouteservice")
        self.assertFalse(body["cached"])
        self.assertEqual(body["suggestions"][0]["id"], "g1")
        self.assertEqual(body["suggestions"][0]["lat"], 21.50)
        self.assertEqual(get.call_args.kwargs["params"]["text"], "Jeddah")
        self.assertEqual(res["Cache-Control"], "no-store")

    def test_repeat_query_is_flagged_cached(self):
        with mock.patch("routing.services.requests.get", return_value=_resp(200, ORS_OK)) as get:
            self._get("Jeddah")
            second = self._get("Jeddah").json()
        self.assertTrue(second["cached"])
        self.assertEqual(get.call_count, 1)

    def test_nominatim_used_when_ors_fails(self):
        def fake(url, **kwargs):
            if "openrouteservice" in url:
                return _resp(500, {})
            return _resp(200, NOMINATIM_OK)

        with mock.patch("routing.services.requests.get", side_effect=fake):
            body = self._get().json()
        self.assertEqual(body["provider"], "nominatim")
        self.assertEqual(body["suggestions"][0]["id"], "relation/42")

    def test_genuine_empty_result_is_200_empty(self):
        with mock.patch(
            "routing.services.requests.get",
            side_effect=lambda url, **kw: _resp(200, {"features": []} if "openroute" in url else []),
        ):
            res = self._get("zzzzqqqq")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json()["suggestions"], [])

    def test_all_providers_down_is_503_not_empty_list(self):
        with mock.patch(
            "routing.services.requests.get", side_effect=requests.ConnectionError("boom")
        ):
            res = self._get()
        self.assertEqual(res.status_code, 503)
        body = res.json()
        self.assertNotIn("suggestions", body)
        self.assertEqual(body["error"]["code"], "location_service_unavailable")
        self.assertNotIn("boom", body["error"]["message"])

    def test_rate_limited_is_429(self):
        with mock.patch("routing.services.requests.get", return_value=_resp(429, {})):
            res = self._get()
        self.assertEqual(res.status_code, 429)
        self.assertEqual(res.json()["error"]["code"], "location_service_rate_limited")

    def test_failures_are_not_cached(self):
        with mock.patch(
            "routing.services.requests.get", side_effect=requests.Timeout("slow")
        ):
            self.assertEqual(self._get().status_code, 503)
        with mock.patch("routing.services.requests.get", return_value=_resp(200, ORS_OK)):
            res = self._get()
        self.assertEqual(res.status_code, 200)
        self.assertFalse(res.json()["cached"])

    def test_blank_query_rejected(self):
        self.assertEqual(self._get("   ").status_code, 400)


@override_settings(OPENROUTESERVICE_API_KEY="")
class MissingKeyTests(SimpleTestCase):
    def setUp(self):
        routing_services._SUGGEST_CACHE.clear()

    def test_no_key_uses_real_nominatim_only_and_errors_when_down(self):
        client = APIClient()
        with mock.patch(
            "routing.services.requests.get", side_effect=requests.ConnectionError("x")
        ) as get:
            res = client.get("/api/places/suggest/", {"q": "Cairo"})
        self.assertEqual(res.status_code, 503)
        urls = [c.args[0] for c in get.call_args_list]
        self.assertTrue(all("nominatim" in u for u in urls))
