"""Shared constants for weather-aware truck routing."""

from enum import IntEnum


class RiskLevel(IntEnum):
    """Ordinal risk levels. Higher value = more severe.

    UNAVAILABLE is not a weather severity — it means the checkpoint could not
    be evaluated and must not be treated as Low / safe.
    """

    UNAVAILABLE = -1
    LOW = 0
    MODERATE = 1
    HIGH = 2
    SEVERE = 3
    NO_TRAVEL = 4

    @classmethod
    def from_label(cls, label: str) -> "RiskLevel":
        normalized = label.strip().lower().replace(" ", "_").replace("-", "_")
        mapping = {
            "unavailable": cls.UNAVAILABLE,
            "unknown": cls.UNAVAILABLE,
            "low": cls.LOW,
            "moderate": cls.MODERATE,
            "high": cls.HIGH,
            "severe": cls.SEVERE,
            "no_travel": cls.NO_TRAVEL,
        }
        try:
            return mapping[normalized]
        except KeyError as exc:
            raise ValueError(f"Unknown risk label: {label}") from exc

    def label(self) -> str:
        return {
            RiskLevel.UNAVAILABLE: "Unavailable",
            RiskLevel.LOW: "Low",
            RiskLevel.MODERATE: "Moderate",
            RiskLevel.HIGH: "High",
            RiskLevel.SEVERE: "Severe",
            RiskLevel.NO_TRAVEL: "No Travel",
        }[self]


MILES_TO_METERS = 1609.344
METERS_TO_MILES = 1 / MILES_TO_METERS
MPS_TO_MPH = 2.2369362921
KMH_TO_MPH = 0.6213711922
MM_TO_INCH = 1 / 25.4
CM_TO_INCH = 1 / 2.54

CHECKPOINT_INTERVALS_MILES = (10, 25, 50)

# In-memory route store TTL is managed by the planner; keep a soft max.
MAX_CACHED_ROUTES = 200
