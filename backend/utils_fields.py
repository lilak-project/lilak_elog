"""
Phase 2 helpers — log-field normalization.

Per the spec, every `number_entry` field on a log carries `{value, error}` no
matter which input variant the user chose:

    single   →   value = raw,                error = 0
    range    →   value = (min+max)/2,        error = (max-min)/2
    multiple →   value = mean(values),       error = stddev(values, sample)

The frontend can also send the already-computed shape `{value, error}` directly
(useful for services pushing logs in machine-friendly form). In that case the
shape is accepted as-is.

These helpers normalize whichever shape the client sent into a canonical
`{value, error, variant, raw}` dict so downstream code (display, search,
aggregation) doesn't have to branch on input form.
"""

from __future__ import annotations

from math import sqrt
from typing import Any, Optional


def _to_float(v: Any) -> Optional[float]:
    if v is None or v == "":
        return None
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def normalize_number_entry(raw: Any, variant: Optional[str] = None) -> dict:
    """Canonicalize a number_entry payload.

    `raw` may be:
      • {"value": x, "error": y}                — already canonical
      • {"single": x}                            — single variant
      • {"min": a, "max": b}                     — range variant
      • {"values": [...]}                        — multiple variant (≤10 slots)
      • a plain number (treated as single)

    Returns: { value, error, variant, raw }  — `raw` echoes the original so the
    UI can re-render the same input rows on edit.
    """
    if isinstance(raw, (int, float)):
        return {"value": float(raw), "error": 0.0, "variant": "single", "raw": {"single": float(raw)}}

    if not isinstance(raw, dict):
        return {"value": 0.0, "error": 0.0, "variant": variant or "single", "raw": {}}

    # Already-canonical {value, error} shape
    if "value" in raw and ("error" in raw or variant is None):
        v = _to_float(raw["value"]) or 0.0
        e = _to_float(raw.get("error", 0)) or 0.0
        return {"value": v, "error": e, "variant": variant or "single", "raw": raw}

    # Multiple — checked first so an explicit {values} raw always wins, even
    # when the format field is declared with a different variant (logs unify
    # every number_entry to the multiple variant).
    if "values" in raw or variant == "multiple":
        vals = [_to_float(x) for x in (raw.get("values") or [])]
        vals = [x for x in vals if x is not None]
        if not vals:
            return {"value": 0.0, "error": 0.0, "variant": "multiple", "raw": {"values": []}}
        n = len(vals)
        mean = sum(vals) / n
        if n > 1:
            # Sample standard deviation (Bessel-corrected). With n=1 it is 0.
            var = sum((v - mean) ** 2 for v in vals) / (n - 1)
            std = sqrt(var)
        else:
            std = 0.0
        return {
            "value": mean,
            "error": std,
            "variant": "multiple",
            "raw": {"values": vals},
        }

    # Single
    if "single" in raw or variant == "single":
        v = _to_float(raw.get("single", raw.get("value")))
        return {
            "value": v if v is not None else 0.0,
            "error": 0.0,
            "variant": "single",
            "raw": {"single": v} if v is not None else {},
        }

    # Range
    if "min" in raw or "max" in raw or variant == "range":
        lo = _to_float(raw.get("min"))
        hi = _to_float(raw.get("max"))
        if lo is None or hi is None:
            return {"value": 0.0, "error": 0.0, "variant": "range", "raw": raw}
        return {
            "value": (lo + hi) / 2.0,
            "error": abs(hi - lo) / 2.0,
            "variant": "range",
            "raw": {"min": lo, "max": hi},
        }

    # Fallback — unrecognized shape
    return {"value": 0.0, "error": 0.0, "variant": variant or "single", "raw": raw}


def normalize_format_fields(custom_values: dict, format_fields: list) -> dict:
    """For each `number_entry` field defined on the format, replace the raw
    value the user submitted with its canonical `{value, error, variant, raw}`
    shape. All other field types pass through untouched.

    `format_fields` is the list of FormatField dicts (already JSON-decoded).
    """
    if not custom_values or not format_fields:
        return custom_values or {}

    out = dict(custom_values)
    by_key = {f["key"]: f for f in format_fields if isinstance(f, dict)}
    for key, raw in list(out.items()):
        spec = by_key.get(key)
        if not spec:
            continue
        if spec.get("field_type") == "number_entry":
            out[key] = normalize_number_entry(raw, spec.get("variant"))
    return out
