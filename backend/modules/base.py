"""
Base class for built-in elog modules.

A Module is a piece of functionality that runs inside elog's own backend
process — no external server needed. Modules run on a configurable interval
and push log entries to elog via the internal API.
"""

from __future__ import annotations


class ModuleBase:
    id: str = ""              # unique snake_case identifier e.g. "net_speed"
    name: str = ""            # display name e.g. "Network Speed"
    description: str = ""
    default_interval_sec: int = 60

    # Declare format fields so module_runner can auto-create a LogFormat.
    # Each entry: {"key": str, "label": str, "type": "number"|"text", "unit": str (optional)}
    fields: list[dict] = []

    async def collect(self) -> dict:
        """Return a dict of field_key → value. Called every interval."""
        raise NotImplementedError
