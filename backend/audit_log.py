"""Shared audit-trail helper.

Records a row in the `audit_events` table. Used across routes (login, register,
user changes, exports, registrations, …) and surfaced to managers via the audit
view. `details` is an optional short JSON/string blob.
"""
import models


def record(db, action, entity_type, entity_id=None, actor=None, details=None):
    ev = models.AuditEvent(
        action=action, entity_type=entity_type, entity_id=entity_id,
        actor=actor, details=details,
    )
    db.add(ev)
    db.commit()
