"""
SQLAlchemy ORM models.
"""

from datetime import datetime, timezone

from sqlalchemy import (
    Boolean, Column, DateTime, Float, ForeignKey,
    Integer, String, Table, Text,
)
from sqlalchemy.orm import relationship

from database import Base


def _now() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


# Many-to-many join table for log entries <-> tags
log_tags = Table(
    "log_tags",
    Base.metadata,
    Column("log_id", Integer, ForeignKey("log_entries.id", ondelete="CASCADE"), primary_key=True),
    Column("tag_id", Integer, ForeignKey("tags.id", ondelete="CASCADE"), primary_key=True),
)


# Many-to-many: a Service can be wired up to many LogFormats, and a format can
# in principle be shared between services (e.g. a generic "Vacuum readout"
# format used by two pump controllers). The actual auto-generated S/E/M formats
# for a system are always 1:1 with that system, but we keep the join
# table flexible so manual reuse is possible.
service_formats = Table(
    "service_formats",
    Base.metadata,
    Column("service_id", Integer, ForeignKey("services.id", ondelete="CASCADE"), primary_key=True),
    Column("format_id",  Integer, ForeignKey("log_formats.id", ondelete="CASCADE"), primary_key=True),
)


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    username = Column(String(64), unique=True, nullable=False, index=True)
    display_name = Column(String(128))
    email = Column(String(256), nullable=True, index=True)
    phone = Column(String(64), nullable=True)
    role = Column(String(16), nullable=False, default="user")  # "user" | "manager"  (system role)
    experiment_role = Column(String(64), nullable=True)         # e.g. "shifter", "operator" (lab role)
    # Experiment participation period (optional; YYYY-MM-DD)
    participation_from = Column(String(10), nullable=True)
    participation_to   = Column(String(10), nullable=True)
    # Profile avatar — shape key (one of 60 designs in HexAvatar) + hex color.
    # Both nullable: pre-existing rows fall back to a deterministic value
    # derived from the username on the client.
    profile_color      = Column(String(16), nullable=True)
    profile_shape      = Column(String(32), nullable=True)
    # Per-user UI preferences: theme, density, size, lang stored as JSON.
    preferences_json   = Column(Text, nullable=True)
    # ── PASSWORD STORAGE ─────────────────────────────────────────────────────
    # Currently: SHA-256 with random salt ("sha256:<salt>:<hash>").
    # To upgrade: swap auth.hash_password / auth.verify_password with bcrypt,
    # Argon2, or institutional LDAP/SSO — no other code needs to change.
    password_hash = Column(String(256), nullable=False)
    # ─────────────────────────────────────────────────────────────────────────
    is_active = Column(Boolean, nullable=False, default=True)
    created_at = Column(DateTime, nullable=False, default=_now)
    updated_at = Column(DateTime, nullable=False, default=_now, onupdate=_now)

    log_entries = relationship("LogEntry", back_populates="author")


class LogFormat(Base):
    """Log entry templates (which fields to show, custom fields).

    Two flavours:
      • format_type='user'   — humans pick this when filing a log
      • format_type='system' — external services or subsystems post against this
                                schema; humans can still use it manually if needed.

    task_type marks the three "task-bearing" system formats. When a log written
    with one of these is created, every embedded task field becomes its own
    follow-up task log linked via parent_log_id.
    """
    __tablename__ = "log_formats"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(128), nullable=False)
    fields_json = Column(Text, nullable=False)   # JSON: list[FormatField]
    is_default = Column(Boolean, nullable=False, default=False)
    notify_community = Column(Boolean, nullable=False, default=False)  # post system msg on log creation
    # NEW (Phase 1a)
    format_type = Column(String(16), nullable=False, default="user", index=True)  # 'user' | 'system'
    task_type   = Column(String(32), nullable=True, index=True)                    # 'start_of_run' | 'end_of_run' | 'monitoring_run' | None
    # The Run/Run-type field on this format is permanently locked to one
    # particular run_type letter ('S'|'R'|'E'|'A'|'M'|'IDLE'). Null = free.
    run_type_lock = Column(String(8), nullable=True)
    # Phase 3: when this format was auto-generated for a specific system
    # service, points back to that service so renames keep the names in sync.
    # Null for hand-made formats and for the 4 built-in default formats.
    subsystem_id = Column(Integer, ForeignKey("services.id", ondelete="SET NULL"),
                          nullable=True, index=True)
    # New alias — same semantics, new name. Populated by migration.
    system_id = Column(Integer, ForeignKey("services.id", ondelete="SET NULL"),
                       nullable=True, index=True)
    created_at = Column(DateTime, nullable=False, default=_now)
    created_by = Column(String(64))
    # Per-format task template: a JSON list of task items that get spawned as
    # child task logs every time a log of this format is filed. Each item:
    #   {"kind": "module", "module_id": "net_speed", "interval_min": 5}
    #   {"kind": "format", "format_id": 7, "title": "Beam check"}
    task_template_json = Column(Text, nullable=True)


class LogEntry(Base):
    __tablename__ = "log_entries"

    id = Column(Integer, primary_key=True, index=True)
    # Per-experiment auto-increment counter, shown in the UI as "#42".
    # Distinct from `id` so we can renumber / soft-delete without confusing users.
    # Set on insert by the route handler: MAX(log_index) + 1.
    log_index = Column(Integer, index=True)
    title = Column(String(512), nullable=True)   # nullable: formats may omit title
    body = Column(Text)

    # Author info (author_id may be NULL for API-generated entries)
    author_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    author_name = Column(String(128), nullable=False)   # denormalized for resilience

    category = Column(String(64), index=True)
    run_number = Column(Integer, index=True)           # single 타입일 때 정수값 (검색 인덱스용)
    run_number_type = Column(String(16), nullable=False, default="single")  # single | range | multiple
    run_number_text = Column(String(256))              # "42" / "1-5,7-10" / "1,3,5"
    # 'level' replaces the old 'severity' column (info | warning | error | critical).
    level = Column(String(16), default="info", index=True)
    # Run type letter that drives the title prefix.
    # S=start  R=running  E=end  A=after  M=monitoring  IDLE=unrelated
    run_type = Column(String(8), nullable=True, index=True)
    # Phase 5: per-run sequential counter. For all logs sharing the same
    # run_number (regardless of run_type), this is 1 for the first one, 2 for
    # the second, etc. Null when there's no run_number (IDLE or unset).
    # Displayed as "(N)" inside the composed title.
    run_log_index = Column(Integer, nullable=True, index=True)
    # Task↔parent link. System-set only — when a Start/End/Monitoring run log is
    # created, each embedded task becomes its own log row with parent_log_id
    # pointing at that triggering log.
    parent_log_id = Column(Integer, ForeignKey("log_entries.id", ondelete="SET NULL"),
                           nullable=True, index=True)
    # Registered task log lifecycle:
    #   None      — a normal (non-task) log
    #   'pending' — a manually-registered task awaiting a human "Go" fill
    #   'filled'  — completed (auto-filled by a module, or filled by a human)
    task_status = Column(String(16), nullable=True, index=True)
    # For auto-fill module tasks: which module backs this task log, and the
    # auto-request interval in minutes (None = one-shot, no rescheduling).
    task_module = Column(String(128), nullable=True)
    task_interval_min = Column(Integer, nullable=True)
    # For auto-fill service tasks: which registered service backs this task log.
    # The background refresh loop calls the service's request_url to fill it.
    task_service_id = Column(Integer, nullable=True)

    # Sticky beam/target context. A log made with a format that has a beam/target
    # field sets a new value; otherwise the log inherits the most recent value.
    beam = Column(String(128), nullable=True, index=True)
    target = Column(String(128), nullable=True, index=True)

    # Provenance
    source = Column(String(128), default="human", index=True)  # "human" or DAQ system name
    is_auto = Column(Boolean, nullable=False, default=False, index=True)  # True = machine-generated

    # Arbitrary extra data from external sources (JSON string)
    metadata_json = Column(Text)

    # Log format (optional)
    format_id = Column(Integer, ForeignKey("log_formats.id", ondelete="SET NULL"), nullable=True)
    format_fields_json = Column(Text)   # JSON: {field_key: value} for custom fields

    # Notice (pinned announcement)
    is_notice = Column(Boolean, nullable=False, default=False, index=True)

    # Soft-delete fields
    is_deleted = Column(Boolean, nullable=False, default=False, index=True)
    deleted_at = Column(DateTime)
    deleted_by = Column(String(64))

    # Audit
    updated_by = Column(String(64))
    created_at = Column(DateTime, nullable=False, default=_now, index=True)
    updated_at = Column(DateTime, nullable=False, default=_now, onupdate=_now)

    author = relationship("User", back_populates="log_entries")
    tags = relationship("Tag", secondary=log_tags, back_populates="log_entries")
    attachments = relationship("Attachment", back_populates="log_entry", cascade="all, delete-orphan")

    # ── Backwards-compat alias ────────────────────────────────────────────────
    # `severity` was renamed to `level` in Phase 1a of the log-system refactor.
    # External clients (and a few legacy routes) still write `.severity`; this
    # property keeps those paths working until every reference is migrated.
    @property
    def severity(self):
        return self.level
    @severity.setter
    def severity(self, v):
        self.level = v


class Tag(Base):
    __tablename__ = "tags"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(64), unique=True, nullable=False, index=True)
    color = Column(String(16), nullable=True)         # bg hex; null = theme (sky) default
    border_color = Column(String(16), nullable=True)  # border hex; null = no/default border
    text_color = Column(String(16), nullable=True)    # text hex; null = auto-contrast

    log_entries = relationship("LogEntry", secondary=log_tags, back_populates="tags")


class Attachment(Base):
    __tablename__ = "attachments"

    id = Column(Integer, primary_key=True, index=True)
    log_id = Column(Integer, ForeignKey("log_entries.id", ondelete="CASCADE"), nullable=False, index=True)
    filename = Column(String(256), nullable=False)          # stored on disk
    original_filename = Column(String(512), nullable=False)  # original upload name
    content_type = Column(String(128))
    size = Column(Integer)
    created_at = Column(DateTime, nullable=False, default=_now)

    log_entry = relationship("LogEntry", back_populates="attachments")


class ApiToken(Base):
    """Tokens used by external DAQ / automation systems to post log entries."""
    __tablename__ = "api_tokens"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(128), nullable=False)
    token = Column(String(256), unique=True, nullable=False, index=True)
    source_name = Column(String(128))   # used as LogEntry.source when this token posts
    is_active = Column(Boolean, nullable=False, default=True)
    created_at = Column(DateTime, nullable=False, default=_now)
    last_used_at = Column(DateTime)


# ── Experiment tab: Services + Systems ───────────────────────────────────────
#
# A Service is an external program / data source that elog can talk to in order
# to fill in task logs. The user manages services through the Experiment tab.
#
# Two flavours, distinguished by `is_system` (was `is_subsystem`):
#   • Plain service — elog REQUESTS data (HV readout, vacuum levels, actuators…)
#       The server polls `request_url` on a schedule, or on demand from the UI.
#   • System — also PUSHES data (online beam counting DAQ etc.)
#       Has its own Start/End/Monitoring run logs that the system can post
#       autonomously, so the elog acts as the sync point for the main run.
#
# All real-time/scheduling/webhook logic ships in later phases; Phase 1b only
# stores the configuration and exposes CRUD.

class Service(Base):
    __tablename__ = "services"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(128), nullable=False, unique=True, index=True)
    description = Column(Text, nullable=True)

    # Where the service runs (informational + future webhook destination).
    ip = Column(String(64), nullable=True)          # legacy — kept for DB compat
    hostname = Column(String(256), nullable=True)   # preferred over ip
    directory = Column(String(512), nullable=True)
    # URL we POST to when we want the service to fill a task log.
    request_url = Column(String(512), nullable=True)

    # Legacy column — kept for DB compatibility. Use is_system for new code.
    is_subsystem = Column(Boolean, nullable=False, default=False, index=True)
    # Distinguishes a regular service from a system (which owns S/E/M
    # formats and can post on its own).
    is_system = Column(Boolean, nullable=False, default=False, index=True)

    # Exactly one service may be the "main system" — the one that uses the
    # global Init/Start/End/Monitoring run log formats (no name prefix).
    is_main_system = Column(Boolean, nullable=False, default=False, index=True)

    # Controls whether elog auto-requests logs from this service.
    # When False, no auto-requests happen regardless of max_interval_sec.
    request_required = Column(Boolean, nullable=False, default=True)

    # Scheduling — Phase 1b stores these; the actual scheduler ships later.
    last_request_at = Column(DateTime, nullable=True)
    next_request_at = Column(DateTime, nullable=True)
    max_interval_sec = Column(Integer, nullable=True)         # auto-request floor

    # Real-time monitoring mode (toggle from the service detail view).
    realtime_enabled  = Column(Boolean, nullable=False, default=False)
    realtime_interval_sec = Column(Float, nullable=True)      # e.g. 0.5

    is_active  = Column(Boolean, nullable=False, default=True)
    created_at = Column(DateTime, nullable=False, default=_now)
    updated_at = Column(DateTime, nullable=False, default=_now, onupdate=_now)
    created_by = Column(String(64))

    log_formats = relationship("LogFormat", secondary=service_formats,
                               backref="services")


class AuditEvent(Base):
    """Light-weight audit trail for writes."""
    __tablename__ = "audit_events"

    id = Column(Integer, primary_key=True, index=True)
    action = Column(String(32), nullable=False)        # create | update | delete
    entity_type = Column(String(32), nullable=False)   # log_entry | user | ...
    entity_id = Column(Integer)
    actor = Column(String(64))                         # username
    details = Column(Text)                             # JSON snapshot / diff
    created_at = Column(DateTime, nullable=False, default=_now, index=True)


class Setting(Base):
    """Per-experiment key/value settings (manager-tunable): require_approval, tabs, …"""
    __tablename__ = "settings"

    key = Column(String(64), primary_key=True)
    value = Column(Text)


class Notice(Base):
    """Pinned announcements (manager-only write)."""
    __tablename__ = "notices"

    id = Column(Integer, primary_key=True, index=True)
    title = Column(String(512), nullable=False)
    body = Column(Text)
    author_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    author_name = Column(String(128), nullable=False)
    is_pinned = Column(Boolean, nullable=False, default=True)
    created_at = Column(DateTime, nullable=False, default=_now)
    updated_at = Column(DateTime, nullable=False, default=_now, onupdate=_now)


class ChatMessage(Base):
    """Community chat messages."""
    __tablename__ = "chat_messages"

    id = Column(Integer, primary_key=True, index=True)
    author_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    author_name = Column(String(128), nullable=False)
    body = Column(Text, nullable=False)
    image_filename = Column(String(256), nullable=True)   # pasted/uploaded image
    log_id = Column(Integer, ForeignKey("log_entries.id", ondelete="SET NULL"), nullable=True)
    log_title = Column(String(512), nullable=True)        # denormalized
    comment_id = Column(Integer, ForeignKey("comments.id", ondelete="SET NULL"), nullable=True)
    is_cross_posted  = Column(Boolean, nullable=False, default=False)  # prevent loops
    is_system        = Column(Boolean, nullable=False, default=False)  # system-generated notification
    is_ai_response   = Column(Boolean, nullable=False, default=False)  # AI bot response
    reply_to_id     = Column(Integer, ForeignKey("chat_messages.id", ondelete="SET NULL"), nullable=True)
    reply_to_author = Column(String(128), nullable=True)   # denormalized
    reply_to_body   = Column(String(200), nullable=True)   # excerpt
    # External bridge metadata — when a message arrives from Dooray/Discord/etc,
    # these are populated; outgoing broadcast skips messages with external_source
    # set (loop prevention).
    external_source = Column(String(32),  nullable=True)   # 'dooray', 'discord', ...
    external_author = Column(String(128), nullable=True)   # author's name on that platform
    created_at      = Column(DateTime, nullable=False, default=_now, index=True)

    author = relationship("User")


class CommunityBridge(Base):
    """A bridge between this community chat and an external platform.
    Each row can carry outgoing (we POST to outgoing_url), incoming (they POST
    to /api/community/incoming/{incoming_token}), or both."""
    __tablename__ = "community_bridges"

    id              = Column(Integer, primary_key=True, index=True)
    name            = Column(String(128), nullable=False)               # 'Dooray Main', 'Discord Dev'
    source_type     = Column(String(32),  nullable=False)               # 'dooray' | 'discord'
    outgoing_url    = Column(String(512), nullable=True)                # webhook to POST when a new local message arrives
    incoming_token  = Column(String(64),  nullable=True, unique=True)   # secret in our incoming URL
    # Optional bot credential — when set, the manager can Start/Stop a relay
    # subprocess from the admin UI. Only used by source_type='discord' today.
    bot_token       = Column(String(256), nullable=True)
    enabled         = Column(Boolean, nullable=False, default=True)
    created_by      = Column(String(64), nullable=True)
    created_at      = Column(DateTime, nullable=False, default=_now)


class Comment(Base):
    """Comments on log entries."""
    __tablename__ = "comments"

    id = Column(Integer, primary_key=True, index=True)
    log_id = Column(Integer, ForeignKey("log_entries.id", ondelete="CASCADE"), nullable=False, index=True)
    author_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    author_name = Column(String(128), nullable=False)
    body = Column(Text, nullable=False)
    created_at = Column(DateTime, nullable=False, default=_now, index=True)

    log_entry = relationship("LogEntry")
    author = relationship("User")


class Infograph(Base):
    """A saved graph/chart built from log variables (Infography tab).
    Behaves like a log entry: shared, live-updating, open/close, comments."""
    __tablename__ = "infographs"

    id = Column(Integer, primary_key=True, index=True)
    # Sequential per-experiment display number ("#42"), like a log entry.
    infograph_index = Column(Integer, nullable=True, index=True)
    title = Column(String(256), nullable=False)
    # 'graph'     — x vs y line graph (x single; y one or many)
    # 'histogram' — single-x value histogram (binned) OR multi-x summed bars
    # 'image'     — a static uploaded/selected image
    kind = Column(String(16), nullable=False, default="graph")
    # JSON arrays of variable keys.
    x_vars = Column(Text, nullable=True)           # JSON list
    y_vars = Column(Text, nullable=True)           # JSON list
    # Histogram (single-x) binning — null = auto.
    n_bins = Column(Integer, nullable=True)
    x_min = Column(Float, nullable=True)
    x_max = Column(Float, nullable=True)
    # legacy single-value columns (kept for compatibility)
    x_var = Column(String(128), nullable=True)
    y_var = Column(String(128), nullable=True)
    chart_type = Column(String(16), nullable=True)
    image_filename = Column(String(256), nullable=True)  # for kind='image'
    tags = Column(Text, nullable=True)                   # JSON list of tag strings
    run = Column(Integer, nullable=True)                 # legacy single run
    run_spec = Column(Text, nullable=True)               # run selection: "1:80, 94:105, !77"
    source = Column(String(128), nullable=True)          # optional source/service label
    y_min = Column(Float, nullable=True)                 # forced y-axis range
    y_max = Column(Float, nullable=True)
    created_by = Column(String(64), nullable=True)
    author_name = Column(String(128), nullable=True)
    created_at = Column(DateTime, nullable=False, default=_now)
    updated_at = Column(DateTime, nullable=False, default=_now, onupdate=_now)


class InfographComment(Base):
    __tablename__ = "infograph_comments"

    id = Column(Integer, primary_key=True, index=True)
    infograph_id = Column(Integer, ForeignKey("infographs.id", ondelete="CASCADE"), nullable=False, index=True)
    author_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    author_name = Column(String(128), nullable=False)
    body = Column(Text, nullable=False)
    created_at = Column(DateTime, nullable=False, default=_now, index=True)


class GSheetConfig(Base):
    """Single-row config for Google Sheets sync (service-account based)."""
    __tablename__ = "gsheet_config"

    id = Column(Integer, primary_key=True, index=True)
    credentials_json = Column(Text, nullable=True)   # service account key JSON
    spreadsheet_id = Column(String(128), nullable=True)
    worksheet = Column(String(128), nullable=True, default="elog")
    enabled = Column(Boolean, nullable=False, default=False)
    auto_sync = Column(Boolean, nullable=False, default=False)
    connected_email = Column(String(256), nullable=True)   # service account email
    last_synced_at = Column(DateTime, nullable=True)
    updated_at = Column(DateTime, nullable=False, default=_now, onupdate=_now)


class Webhook(Base):
    """Outgoing webhook endpoints (e.g. Dooray, Slack) notified on new log creation."""
    __tablename__ = "webhooks"

    id         = Column(Integer, primary_key=True, index=True)
    name       = Column(String(128), nullable=False)
    url        = Column(String(512), nullable=False)
    enabled    = Column(Boolean, nullable=False, default=True)
    created_at = Column(DateTime, nullable=False, default=_now)


class ShiftPattern(Base):
    """Reusable shift schedule pattern (e.g., 3-shift rotation with multiple roles)."""
    __tablename__ = "shift_patterns"

    id              = Column(Integer, primary_key=True, index=True)
    name            = Column(String(128), nullable=False)
    # slots_json: [{"label": "주간", "start_hour": 8, "end_hour": 16, "color": "#...", "roles": [...]}, ...]
    slots_json      = Column(Text, nullable=False)
    # roles_json: ["shifter", "operator", "expert"] (legacy; per-slot roles are preferred)
    roles_json      = Column(Text, nullable=False)
    effective_from  = Column(String(10), nullable=True)   # 'YYYY-MM-DD' or NULL (no start bound)
    effective_to    = Column(String(10), nullable=True)   # 'YYYY-MM-DD' or NULL (no end bound)
    is_active       = Column(Boolean, nullable=False, default=True)
    created_by      = Column(String(64))
    created_at      = Column(DateTime, nullable=False, default=_now)


class ScheduleEvent(Base):
    """Schedule events — experiments, shifts, or generic time blocks."""
    __tablename__ = "schedule_events"

    id           = Column(Integer, primary_key=True, index=True)
    title        = Column(String(256), nullable=False)
    description  = Column(Text)
    start_at     = Column(DateTime, nullable=False, index=True)
    end_at       = Column(DateTime, nullable=False, index=True)
    event_type   = Column(String(32), nullable=False, default="experiment", index=True)
    # ^ "experiment" | "shift" | "other"
    color        = Column(String(16))  # optional hex like "#3b82f6"

    # Experiment-specific
    data_type    = Column(String(128))  # what data to collect

    # Shift-specific
    shift_pattern_id   = Column(Integer, ForeignKey("shift_patterns.id", ondelete="SET NULL"), nullable=True)
    shift_slot_label   = Column(String(64))   # which slot in the pattern, e.g. "주간"
    shift_role         = Column(String(64))   # role within the shift, e.g. "shifter"
    assigned_user_id   = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    assigned_user_name = Column(String(128))  # denormalized

    created_by   = Column(String(64))
    created_at   = Column(DateTime, nullable=False, default=_now)
    updated_at   = Column(DateTime, nullable=False, default=_now, onupdate=_now)


class FreeUser(Base):
    """Free-form user (name only) for shift schedule — can later be claimed by a real user."""
    __tablename__ = "free_users"

    id            = Column(Integer, primary_key=True, index=True)
    name          = Column(String(128), nullable=False)
    claimed_by_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)
    claimed_at    = Column(DateTime)
    display_order = Column(Integer, nullable=False, default=0)
    created_by    = Column(String(64))
    created_at    = Column(DateTime, nullable=False, default=_now)


class ShiftAssignment(Base):
    """A user (real or free) signed up for a shift slot on a specific date."""
    __tablename__ = "shift_assignments"

    id           = Column(Integer, primary_key=True, index=True)
    date         = Column(String(10), nullable=False, index=True)   # YYYY-MM-DD
    slot_label   = Column(String(64), nullable=False)
    user_id      = Column(Integer, ForeignKey("users.id",      ondelete="CASCADE"), nullable=True, index=True)
    free_user_id = Column(Integer, ForeignKey("free_users.id", ondelete="CASCADE"), nullable=True, index=True)
    user_name    = Column(String(128), nullable=False)              # denormalized
    role         = Column(String(64))
    created_by   = Column(String(64))
    created_at   = Column(DateTime, nullable=False, default=_now)


class AiBot(Base):
    """AI assistant bots (ChatGPT, Claude) that respond to @mentions in community chat."""
    __tablename__ = "ai_bots"

    id             = Column(Integer, primary_key=True, index=True)
    name           = Column(String(32), unique=True, nullable=False)  # @mention handle e.g. "gpt"
    display_name   = Column(String(64))                               # shown in UI
    provider       = Column(String(16), nullable=False)               # "openai" | "anthropic"
    api_key        = Column(String(512), nullable=False)
    model          = Column(String(64))                               # e.g. "gpt-4o-mini"
    system_prompt  = Column(Text)                                     # custom system prompt
    context_count  = Column(Integer, nullable=False, default=10)      # recent messages to include
    enabled        = Column(Boolean, nullable=False, default=True)
    created_at     = Column(DateTime, nullable=False, default=_now)
    created_by     = Column(String(64))


class Module(Base):
    """Built-in elog modules (e.g. net_speed) — run inside the elog process."""
    __tablename__ = "modules"

    id           = Column(String(64), primary_key=True)   # e.g. "net_speed"
    enabled      = Column(Boolean, nullable=False, default=False)
    interval_sec = Column(Integer, nullable=False, default=60)


class Notification(Base):
    """In-app notifications (e.g. someone commented on your log)."""
    __tablename__ = "notifications"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    from_user_name = Column(String(128))          # who triggered it
    log_id = Column(Integer, ForeignKey("log_entries.id", ondelete="CASCADE"), nullable=True)
    log_title = Column(String(512))               # denormalised copy
    comment_id = Column(Integer, ForeignKey("comments.id", ondelete="CASCADE"), nullable=True)
    comment_excerpt = Column(String(256))         # first 200 chars
    notif_type = Column(String(32), nullable=False, default="comment")
    is_read = Column(Boolean, nullable=False, default=False)
    created_at = Column(DateTime, nullable=False, default=_now, index=True)
