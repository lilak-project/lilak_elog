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

    # An ALREADY-CANONICAL value handed back to us. The compose form loads
    # `{value, error, variant, raw}` into its state and sends it straight back
    # for any field the user did not touch, so this shape arrives on every edit.
    # Re-wrapping it buried the sample list one level down — the field then read
    # as a single averaged number with `raw.values` gone, and the next
    # accumulation started over from that one number. The samples were still in
    # the JSON, nested, with nothing able to find them. Unwrap instead.
    if isinstance(raw.get("raw"), dict):
        return normalize_number_entry(raw["raw"], raw.get("variant") or variant)

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


def accumulate_number_entries(previous: dict, incoming: dict, format_fields: list) -> dict:
    """Merge a fresh reading into what a log already holds.

    Every `number_entry` field keeps its whole SERIES: the new reading is
    appended to the samples already there and the field is re-canonicalized as
    the `multiple` variant, so it reads as mean ± stddev while `raw.values`
    keeps each individual sample. Any other field type is simply replaced — a
    step label or a timestamp has no series to keep, only a latest value.

    This is what lets a task log that refills on an interval RECORD each
    reading instead of overwriting the last one, without the field count
    growing: one field, N samples.

    Declared variant is deliberately not consulted. A service registered by
    handshake declares `single` for every number it sends (that is what
    _auto_create_log_format writes), so honouring the declaration would mean
    accumulation never happened for the services this exists to serve — and
    normalize_number_entry already treats an explicit {values} as authoritative
    over the declared variant for the same reason.
    """
    # A field can opt out: `accumulate: false` keeps only the latest reading.
    # Absent means yes, so every format written before the switch existed keeps
    # behaving as it did.
    keys = {f["key"] for f in (format_fields or [])
            if isinstance(f, dict) and f.get("field_type") == "number_entry"
            and f.get("key") and f.get("accumulate", True)}
    out = dict(previous or {})
    for key, fresh in (incoming or {}).items():
        if key not in keys:
            out[key] = fresh
            continue
        prior = out.get(key) if isinstance(out.get(key), dict) else {}
        samples = list((prior.get("raw") or {}).get("values") or [])
        if not samples and prior.get("value") is not None:
            # A field last written as a scalar still holds one real reading;
            # dropping it would lose every sample taken before accumulation
            # started, including on the logs already in the database.
            samples = [prior["value"]]
        add = (fresh.get("raw") or {}).get("values") if isinstance(fresh, dict) else None
        if add is None:
            add = [fresh.get("value")] if isinstance(fresh, dict) else [fresh]
        samples.extend(v for v in add if v is not None)
        out[key] = normalize_number_entry({"values": samples}, "multiple")
    return out


#: The key sets a number_entry payload can arrive as. Matching on shape is what
#: lets an UNDECLARED field still be understood; keeping the set closed is what
#: stops it from swallowing some other JSON a service happens to send.
_ENTRY_KEYS = {"single", "values", "min", "max", "value", "error", "variant", "raw"}
_ENTRY_CORE = {"single", "values", "min", "max", "value"}


def looks_like_number_entry(value) -> bool:
    """Is this dict one of the number_entry input shapes?"""
    if not isinstance(value, dict) or not value:
        return False
    keys = set(value)
    return keys <= _ENTRY_KEYS and bool(keys & _ENTRY_CORE)


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
        if spec is None:
            # A system sends what it measures; the format is a separate thing
            # somebody configured, and the two drift. MTE pushes run_number,
            # run_length_s and active_channels on "Start of run log", which
            # declares four builtins and no custom fields at all — so these were
            # stored exactly as sent, `{"single": 457.0}`, and the card had
            # nothing to recognise and printed "[object Object]". Canonicalise
            # anything shaped like a reading, declared or not.
            # Scalar shapes only. A declared number_entry field means "this is a
            # measurement", so a list of them averages. An UNDECLARED
            # `{"values": [...]}` carries no such promise — MTE's
            # `active_channels` is the SET of channels that are on, and
            # averaging 3, 9, 10, 13, 14, 15 into "10.67 ± 4.41" states a fact
            # about the run that is not true. Left alone, it renders as the list
            # it is.
            if looks_like_number_entry(raw) and "values" not in raw:
                out[key] = normalize_number_entry(raw)
            continue
        # `custom_type` is the older spelling; some formats still use it.
        if (spec.get("field_type") or spec.get("custom_type")) == "number_entry":
            out[key] = normalize_number_entry(raw, spec.get("variant"))
    return out
