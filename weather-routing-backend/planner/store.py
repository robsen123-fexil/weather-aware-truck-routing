"""Simple in-memory route cache for GET /api/routes/<route_id>/."""

from __future__ import annotations

import threading
from collections import OrderedDict
from typing import Any

from django.conf import settings

from shared.constants import MAX_CACHED_ROUTES


class RouteStore:
    def __init__(self, max_size: int = MAX_CACHED_ROUTES) -> None:
        self._max_size = max_size
        self._data: OrderedDict[str, dict[str, Any]] = OrderedDict()
        self._lock = threading.Lock()

    def put(self, route_id: str, payload: dict[str, Any]) -> None:
        with self._lock:
            if route_id in self._data:
                self._data.move_to_end(route_id)
            self._data[route_id] = payload
            while len(self._data) > self._max_size:
                self._data.popitem(last=False)

    def get(self, route_id: str) -> dict[str, Any] | None:
        with self._lock:
            item = self._data.get(route_id)
            if item is not None:
                self._data.move_to_end(route_id)
            return item


_store: RouteStore | None = None


def get_route_store() -> RouteStore:
    global _store
    if _store is None:
        max_size = getattr(settings, "MAX_CACHED_ROUTES", MAX_CACHED_ROUTES)
        _store = RouteStore(max_size=max_size)
    return _store
