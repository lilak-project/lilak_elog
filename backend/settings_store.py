"""Per-experiment key/value settings store (manager-tunable).

Values are JSON-encoded in the `settings` table. PUBLIC_KEYS are the settings
the frontend is allowed to read (so it can hide tabs, gate self-registration,
…). Everything else stays manager-only.
"""
import json

import models

# key -> default value (also the read whitelist)
PUBLIC_KEYS = {
    "require_approval": False,   # new self-registrations need manager approval
    "tabs_disabled": [],         # tab types a manager has hidden (stage 2)
}


def get_setting(db, key, default=None):
    row = db.query(models.Setting).filter(models.Setting.key == key).first()
    if not row:
        return default
    try:
        return json.loads(row.value)
    except Exception:
        return row.value


def set_setting(db, key, value):
    enc = json.dumps(value, ensure_ascii=False)
    row = db.query(models.Setting).filter(models.Setting.key == key).first()
    if row:
        row.value = enc
    else:
        db.add(models.Setting(key=key, value=enc))
    db.commit()


def public_settings(db):
    return {k: get_setting(db, k, default) for k, default in PUBLIC_KEYS.items()}
