"""
Network Speed module — measures internet connectivity by timing an HTTP
HEAD request to a reliable endpoint. Lightweight: no bandwidth consumed,
just round-trip latency in milliseconds.
"""

from __future__ import annotations

import time
import asyncio
from urllib.request import urlopen, Request
from urllib.error import URLError

from modules.base import ModuleBase


class NetSpeedModule(ModuleBase):
    id = "net_speed"
    name = "Network Speed"
    description = "Measures internet round-trip latency (ms) via HTTP HEAD request."
    default_interval_sec = 60

    fields = [
        {"key": "response_ms", "label": "Response (ms)", "type": "number", "unit": "ms", "metric": True},
    ]

    _probe_url = "https://www.google.com"
    _timeout_sec = 5

    async def collect(self) -> dict:
        """Return {'response_ms': <int>} or {'response_ms': -1} on error."""
        loop = asyncio.get_event_loop()
        result = await loop.run_in_executor(None, self._probe)
        return result

    def _probe(self) -> dict:
        req = Request(self._probe_url, method="HEAD")
        try:
            t0 = time.monotonic()
            with urlopen(req, timeout=self._timeout_sec):
                pass
            elapsed_ms = int((time.monotonic() - t0) * 1000)
            return {"response_ms": elapsed_ms}
        except (URLError, OSError):
            return {"response_ms": -1}
