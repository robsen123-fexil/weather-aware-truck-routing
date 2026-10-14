from datetime import datetime, timezone

from django.test import SimpleTestCase

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
