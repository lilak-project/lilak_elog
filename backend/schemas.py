"""
Pydantic request/response schemas.
"""

from datetime import datetime
from typing import Any, Optional
from pydantic import BaseModel, EmailStr, field_validator

from auth import validate_username, validate_password


# ── Auth ─────────────────────────────────────────────────────────────────────

class LoginRequest(BaseModel):
    username: str
    password: str

class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user_id: int
    username: str
    role: str


# ── Registration (self-sign-up) ───────────────────────────────────────────────

class RegisterRequest(BaseModel):
    username: str
    email: str          # 이메일 필수
    password: str
    display_name: Optional[str] = None
    # Optional fields
    phone: Optional[str] = None
    participation_from: Optional[str] = None     # 'YYYY-MM-DD'
    participation_to: Optional[str] = None
    experiment_role: Optional[str] = None        # role within the experiment (e.g. 'shifter')
    profile_color: Optional[str] = None          # '#RRGGBB' avatar tint
    profile_shape: Optional[str] = None          # HexAvatar shape key

    @field_validator("username")
    @classmethod
    def _check_username(cls, v):
        try:
            return validate_username(v)
        except ValueError as e:
            raise ValueError(str(e))

    @field_validator("password")
    @classmethod
    def _check_password(cls, v):
        try:
            return validate_password(v)
        except ValueError as e:
            raise ValueError(str(e))


# ── Users ────────────────────────────────────────────────────────────────────

class UserBase(BaseModel):
    username: str
    display_name: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None
    role: str = "user"
    experiment_role: Optional[str] = None
    participation_from: Optional[str] = None    # 'YYYY-MM-DD'
    participation_to: Optional[str] = None
    profile_color: Optional[str] = None         # '#RRGGBB' hex
    profile_shape: Optional[str] = None         # HexAvatar shape key (e.g. 'lotus', 'comet')

class UserCreate(UserBase):
    password: str

    @field_validator("username")
    @classmethod
    def _check_username(cls, v):
        try:
            return validate_username(v)
        except ValueError as e:
            raise ValueError(str(e))

    @field_validator("password")
    @classmethod
    def _check_password(cls, v):
        try:
            return validate_password(v)
        except ValueError as e:
            raise ValueError(str(e))

class UserUpdate(BaseModel):
    display_name: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None
    role: Optional[str] = None
    experiment_role: Optional[str] = None
    password: Optional[str] = None
    is_active: Optional[bool] = None
    participation_from: Optional[str] = None
    participation_to: Optional[str] = None
    profile_color: Optional[str] = None
    profile_shape: Optional[str] = None

    @field_validator("password")
    @classmethod
    def _check_password(cls, v):
        if v is None:
            return v
        try:
            return validate_password(v)
        except ValueError as e:
            raise ValueError(str(e))

class UserOut(UserBase):
    id: int
    is_active: bool
    created_at: datetime
    updated_at: datetime
    log_count: int = 0

    class Config:
        from_attributes = True


# ── Log Transfer ──────────────────────────────────────────────────────────────

class LogTransferRequest(BaseModel):
    """두 계정의 비밀번호를 모두 확인한 뒤 로그 이전."""
    from_username: str
    from_password: str
    to_username: str
    to_password: str


class LogTransferAdminRequest(BaseModel):
    """Manager가 비밀번호 없이 로그를 이전."""
    from_username: str
    to_username: str


# ── Tags ─────────────────────────────────────────────────────────────────────

class TagOut(BaseModel):
    id: int
    name: str
    color: Optional[str] = None
    border_color: Optional[str] = None
    text_color: Optional[str] = None

    class Config:
        from_attributes = True


class TagManageOut(BaseModel):
    id: int
    name: str
    color: Optional[str] = None
    border_color: Optional[str] = None
    text_color: Optional[str] = None
    count: int = 0
    builtin: bool = False


class TagUpdate(BaseModel):
    name: Optional[str] = None
    color: Optional[str] = None          # bg hex; empty string clears to theme default
    border_color: Optional[str] = None   # border hex; empty string clears
    text_color: Optional[str] = None     # text hex; empty string clears (auto)


# ── Attachments ──────────────────────────────────────────────────────────────

class AttachmentOut(BaseModel):
    id: int
    log_id: int
    filename: str
    original_filename: str
    content_type: Optional[str]
    size: Optional[int]
    created_at: datetime

    class Config:
        from_attributes = True


# ── Log Formats ───────────────────────────────────────────────────────────────

class FormatField(BaseModel):
    """A single field definition within a log format."""
    key: str                          # unique key within format
    label: str                        # display label (locked for builtins)
    field_type: str                   # "builtin" | "text" | "number" | "attachment" | "number_entry"
    builtin_id: Optional[str] = None  # if field_type == "builtin"
    # number_entry sub-shape: 'single' | 'range' | 'multiple'
    variant: Optional[str] = None
    placeholder: Optional[str] = None
    required: bool = False
    order: int = 0
    unit: Optional[str] = None         # display unit (e.g. "ms")
    metric: bool = False               # plottable in Infography (number/number_entry)
    auto_title: bool = False           # (title builtin) use the format name as the title

class LogFormatCreate(BaseModel):
    name: str
    fields: list[FormatField]
    is_default: bool = False
    notify_community: bool = False
    # Phase 1a additions
    format_type: str = "user"          # 'user' | 'system'
    task_type: Optional[str] = None    # 'start_of_run' | 'end_of_run' | 'monitoring_run' | None
    run_type_lock: Optional[str] = None  # 'S'|'R'|'E'|'A'|'M'|'IDLE' | None

class LogFormatUpdate(BaseModel):
    name: Optional[str] = None
    fields: Optional[list[FormatField]] = None
    is_default: Optional[bool] = None
    notify_community: Optional[bool] = None
    format_type: Optional[str] = None
    task_type: Optional[str] = None
    run_type_lock: Optional[str] = None

class LogFormatOut(BaseModel):
    id: int
    name: str
    fields: list[FormatField]
    is_default: bool
    notify_community: bool = False
    format_type: str = "user"
    task_type: Optional[str] = None
    run_type_lock: Optional[str] = None
    subsystem_id: Optional[int] = None   # legacy
    system_id: Optional[int] = None
    system_name: Optional[str] = None   # resolved service name for grouping
    owner_kind: Optional[str] = None     # 'system' | 'service' | 'module' | None
    created_at: datetime
    created_by: Optional[str]

    class Config:
        from_attributes = True


# ── Log Entries ──────────────────────────────────────────────────────────────

class LogEntryCreate(BaseModel):
    title: Optional[str] = None
    body: Optional[str] = None
    category: Optional[str] = None
    run_number: Optional[int] = None
    run_number_type: str = "single"
    run_number_text: Optional[str] = None
    # 'level' replaces 'severity'. Accept both during the transition window so
    # external clients aren't forced to update at the same time as the UI.
    # Must default to None (not "info") so a client sending only 'severity'
    # falls through to the alias in create_log.
    level: Optional[str] = None
    severity: Optional[str] = None        # legacy alias — copied into level if level not set
    run_type: Optional[str] = None        # 'S'|'R'|'E'|'A'|'M'|'IDLE'
    beam: Optional[str] = None            # set when the format has a beam field
    target: Optional[str] = None          # set when the format has a target field
    tags: list[str] = []
    source: str = "human"
    is_auto: bool = False
    is_notice: bool = False
    metadata_json: Optional[str] = None
    format_id: Optional[int] = None
    format_fields: Optional[dict] = None   # custom field values {key: value}
    # log_type: token 기반 자동 format 연결 (format_id 없이 사용 가능)
    #   0  = 일반 서비스 로그 (handshake로 생성된 "{name} log" 포맷)
    #   11 = init_of_run
    #   12 = start_of_run
    #   13 = end_of_run
    #   14 = monitoring_run
    log_type: Optional[int] = None

class LogEntryUpdate(BaseModel):
    title: Optional[str] = None
    body: Optional[str] = None
    category: Optional[str] = None
    run_number: Optional[int] = None
    run_number_type: Optional[str] = None
    run_number_text: Optional[str] = None
    level: Optional[str] = None
    severity: Optional[str] = None        # legacy alias
    run_type: Optional[str] = None
    beam: Optional[str] = None
    target: Optional[str] = None
    tags: Optional[list[str]] = None
    is_notice: Optional[bool] = None
    format_id: Optional[int] = None
    format_fields: Optional[dict] = None

class LogEntrySummary(BaseModel):
    id: int
    log_index: Optional[int] = None    # "#42" auto-counter
    title: Optional[str]
    body_excerpt: Optional[str] = None  # first 300 chars for "full" view
    author_name: str
    category: Optional[str]
    run_number: Optional[int]
    run_number_type: str = "single"
    run_number_text: Optional[str] = None
    level: str
    run_type: Optional[str] = None
    beam: Optional[str] = None
    target: Optional[str] = None
    run_log_index: Optional[int] = None     # "(N)" per-run counter
    parent_log_id: Optional[int] = None
    task_status: Optional[str] = None        # None | 'pending' | 'filled'
    task_module: Optional[str] = None
    task_service_id: Optional[int] = None
    task_interval_min: Optional[int] = None
    source: str
    is_auto: bool
    is_notice: bool = False
    is_deleted: bool
    tags: list[TagOut]
    attachment_count: int
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True

class LogEntryDetail(LogEntrySummary):
    body: Optional[str]
    author_id: Optional[int]
    metadata_json: Optional[str]
    updated_by: Optional[str]
    deleted_at: Optional[datetime]
    deleted_by: Optional[str]
    attachments: list[AttachmentOut]
    format_id: Optional[int] = None
    format_fields_json: Optional[str] = None
    # Phase 6b: child task logs spawned from this one (only populated for
    # parent task logs — Start/End/Monitoring system formats). The frontend
    # uses this to render an inline "Tasks" section on the parent card.
    child_task_ids: list[int] = []

    class Config:
        from_attributes = True


class LogListResponse(BaseModel):
    items: list[LogEntrySummary]
    total: int
    page: int
    page_size: int


# ── Public user info (no auth required) ──────────────────────────────────────

class UserPublic(BaseModel):
    id: int
    username: str
    display_name: Optional[str] = None
    email: Optional[str] = None
    experiment_role: Optional[str] = None
    profile_color: Optional[str] = None
    profile_shape: Optional[str] = None

    class Config:
        from_attributes = True


# ── Attachment with log entry info ────────────────────────────────────────────

class AttachmentWithLog(AttachmentOut):
    log_title: Optional[str]
    log_author: str
    log_run_number: Optional[int] = None
    log_run_number_type: str = "single"
    log_run_number_text: Optional[str] = None
    log_created_at: datetime
    log_tags: list[TagOut] = []
    log_level: str = "info"


class AttachmentListResponse(BaseModel):
    items: list[AttachmentWithLog]
    total: int
    page: int
    page_size: int


# ── API Tokens ────────────────────────────────────────────────────────────────

class ApiTokenCreate(BaseModel):
    name: str
    source_name: Optional[str] = None

class ApiTokenOut(BaseModel):
    id: int
    name: str
    token: str
    source_name: Optional[str]
    is_active: bool
    created_at: datetime
    last_used_at: Optional[datetime]

    class Config:
        from_attributes = True


# ── Notices ──────────────────────────────────────────────────────────────────

class NoticeCreate(BaseModel):
    title: str
    body: Optional[str] = None
    is_pinned: bool = True

class NoticeUpdate(BaseModel):
    title: Optional[str] = None
    body: Optional[str] = None
    is_pinned: Optional[bool] = None

class NoticeOut(BaseModel):
    id: int
    title: str
    body: Optional[str]
    author_name: str
    is_pinned: bool
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


# ── Community chat ─────────────────────────────────────────────────────────────

class ChatMessageCreate(BaseModel):
    body: str
    log_id: Optional[int] = None        # optional log link
    reply_to_id: Optional[int] = None   # reply to another message

class ChatMessageOut(BaseModel):
    id: int
    author_name: str
    body: str
    image_filename: Optional[str]
    log_id: Optional[int]
    log_title: Optional[str]
    comment_id: Optional[int]
    is_cross_posted: bool
    is_system: bool = False
    is_ai_response: bool = False
    reply_to_id: Optional[int] = None
    reply_to_author: Optional[str] = None
    reply_to_body: Optional[str] = None
    external_source: Optional[str] = None
    external_author: Optional[str] = None
    created_at: datetime

    class Config:
        from_attributes = True


# ── Community bridges (Dooray / Discord etc.) ────────────────────────────────

class CommunityBridgeCreate(BaseModel):
    name: str
    source_type: str                     # 'dooray' | 'discord' | 'slack'
    outgoing_url: Optional[str] = None
    enable_incoming: bool = False        # generate an incoming_token if True
    enabled: bool = True

class CommunityBridgeUpdate(BaseModel):
    name: Optional[str] = None
    outgoing_url: Optional[str] = None
    rotate_token: bool = False           # request a new incoming_token
    enable_incoming: Optional[bool] = None  # toggle incoming on/off
    enabled: Optional[bool] = None
    bot_token: Optional[str] = None      # set/replace Discord bot token

class CommunityBridgeOut(BaseModel):
    id: int
    name: str
    source_type: str
    outgoing_url: Optional[str]
    incoming_token: Optional[str]
    incoming_url: Optional[str]
    has_bot_token: bool = False          # we never return the raw token to the UI
    relay_status: Optional[str] = None   # 'running' | 'stopped' | 'error'
    relay_pid: Optional[int] = None
    relay_log_tail: Optional[str] = None # last few lines, for live status
    enabled: bool
    created_at: datetime

    class Config:
        from_attributes = True


# ── Comments ─────────────────────────────────────────────────────────────────

class CommentCreate(BaseModel):
    body: str
    report: bool = False    # True → tag the log #reported + flag in community

class CommentOut(BaseModel):
    id: int
    log_id: int
    author_name: str
    body: str
    created_at: datetime

    class Config:
        from_attributes = True


# ── Notifications ─────────────────────────────────────────────────────────────

class NotificationOut(BaseModel):
    id: int
    from_user_name: Optional[str]
    log_id: Optional[int]
    log_title: Optional[str]
    comment_id: Optional[int]
    comment_excerpt: Optional[str]
    notif_type: str
    is_read: bool
    created_at: datetime

    class Config:
        from_attributes = True


# ── Search ────────────────────────────────────────────────────────────────────

class SearchParams(BaseModel):
    q: Optional[str] = None
    author: Optional[str] = None
    tag: Optional[str] = None
    run_number: Optional[int] = None
    category: Optional[str] = None
    level: Optional[str] = None
    source: Optional[str] = None
    is_auto: Optional[bool] = None
    date_from: Optional[datetime] = None
    date_to: Optional[datetime] = None
    include_deleted: bool = False
    page: int = 1
    page_size: int = 20


# ── Schedule ─────────────────────────────────────────────────────────────────

class ShiftRoleSpec(BaseModel):
    name: str
    color: Optional[str] = None   # e.g. "emerald", "blue", "amber", "purple"

class ShiftSlot(BaseModel):
    label: str
    start_hour: int           # 0-23
    end_hour: int             # 0-23 (if <= start_hour, wraps to next day)
    color: Optional[str] = None
    roles: list[ShiftRoleSpec] = []   # required roles for this slot

class ShiftPatternCreate(BaseModel):
    name: str
    slots: list[ShiftSlot]
    roles: list[str]
    effective_from: Optional[str] = None       # 'YYYY-MM-DD'
    effective_to: Optional[str] = None
    is_active: bool = True

class ShiftPatternUpdate(BaseModel):
    name: Optional[str] = None
    slots: Optional[list[ShiftSlot]] = None
    roles: Optional[list[str]] = None
    effective_from: Optional[str] = None
    effective_to: Optional[str] = None
    is_active: Optional[bool] = None

class ShiftPatternOut(BaseModel):
    id: int
    name: str
    slots: list[ShiftSlot]
    roles: list[str]
    effective_from: Optional[str] = None
    effective_to: Optional[str] = None
    is_active: bool
    created_at: datetime
    created_by: Optional[str]

    class Config:
        from_attributes = True


class ScheduleEventCreate(BaseModel):
    title: str
    description: Optional[str] = None
    start_at: datetime
    end_at: datetime
    event_type: str = "experiment"   # experiment | shift | other
    color: Optional[str] = None
    data_type: Optional[str] = None
    # Shift fields
    shift_pattern_id: Optional[int] = None
    shift_slot_label: Optional[str] = None
    shift_role: Optional[str] = None
    assigned_user_id: Optional[int] = None
    assigned_user_name: Optional[str] = None

class ScheduleEventUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    start_at: Optional[datetime] = None
    end_at: Optional[datetime] = None
    event_type: Optional[str] = None
    color: Optional[str] = None
    data_type: Optional[str] = None
    shift_pattern_id: Optional[int] = None
    shift_slot_label: Optional[str] = None
    shift_role: Optional[str] = None
    assigned_user_id: Optional[int] = None
    assigned_user_name: Optional[str] = None

class ScheduleEventOut(BaseModel):
    id: int
    title: str
    description: Optional[str]
    start_at: datetime
    end_at: datetime
    event_type: str
    color: Optional[str]
    data_type: Optional[str]
    shift_pattern_id: Optional[int]
    shift_slot_label: Optional[str]
    shift_role: Optional[str]
    assigned_user_id: Optional[int]
    assigned_user_name: Optional[str]
    created_by: Optional[str]
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class RunSpan(BaseModel):
    """Paired start/end of run from log entries."""
    run_number: int
    title: Optional[str]
    start_at: datetime
    end_at: Optional[datetime]      # None = still running
    start_log_id: int
    end_log_id: Optional[int]
    data_type: Optional[str]


class FreeUserCreate(BaseModel):
    name: str
    display_order: int = 0

class FreeUserUpdate(BaseModel):
    name: Optional[str] = None
    display_order: Optional[int] = None

class FreeUserOut(BaseModel):
    id: int
    name: str
    claimed_by_id: Optional[int]
    claimed_at: Optional[datetime]
    display_order: int
    created_by: Optional[str]
    created_at: datetime

    class Config:
        from_attributes = True


class ShiftAssignmentCreate(BaseModel):
    date: str                           # YYYY-MM-DD
    slot_label: str
    user_id: Optional[int] = None
    free_user_id: Optional[int] = None
    user_name: str
    role: Optional[str] = None

class ShiftAssignmentOut(BaseModel):
    id: int
    date: str
    slot_label: str
    user_id: Optional[int]
    free_user_id: Optional[int]
    user_name: str
    role: Optional[str]
    created_by: Optional[str]
    created_at: datetime

    class Config:
        from_attributes = True


class ShiftAuthorLog(BaseModel):
    """A log entry from a user that overlaps a shift slot — used as a marker on the timeline."""
    log_id: int
    title: Optional[str]
    user_name: str         # author username — matched to assignment.user_name
    created_at: datetime


# ── AI Bots ───────────────────────────────────────────────────────────────────

class AiBotCreate(BaseModel):
    name: str                              # @mention handle, e.g. "gpt"
    display_name: Optional[str] = None
    provider: str                          # "openai" | "anthropic"
    api_key: str
    model: Optional[str] = None           # e.g. "gpt-4o-mini"
    system_prompt: Optional[str] = None
    context_count: int = 10
    enabled: bool = True

class AiBotUpdate(BaseModel):
    display_name: Optional[str] = None
    provider: Optional[str] = None
    api_key: Optional[str] = None         # only updated when explicitly provided
    model: Optional[str] = None
    system_prompt: Optional[str] = None
    context_count: Optional[int] = None
    enabled: Optional[bool] = None

class AiBotOut(BaseModel):
    id: int
    name: str
    display_name: Optional[str]
    provider: str
    api_key_hint: str                      # masked: "sk-...abcd"
    model: Optional[str]
    system_prompt: Optional[str]
    context_count: int
    enabled: bool
    created_at: datetime
    created_by: Optional[str]

    class Config:
        from_attributes = True

# ── Modules ──────────────────────────────────────────────────────────────────

class ModuleOut(BaseModel):
    id: str
    name: str
    description: str
    default_interval_sec: int
    enabled: bool
    interval_sec: int

    class Config:
        from_attributes = True

class ModuleUpdate(BaseModel):
    enabled: Optional[bool] = None
    interval_sec: Optional[int] = None


# ── Services (Experiment tab) ────────────────────────────────────────────────

class ServiceBase(BaseModel):
    name: str
    description: Optional[str] = None
    ip: Optional[str] = None            # legacy — kept for backwards compat
    hostname: Optional[str] = None      # preferred
    directory: Optional[str] = None
    request_url: Optional[str] = None
    is_system: bool = False
    is_subsystem: bool = False   # legacy alias, kept for backwards compat
    is_main_system: bool = False
    max_interval_sec: Optional[int] = None
    realtime_interval_sec: Optional[float] = None
    request_required: bool = True
    is_active: bool = True

class DiscoverField(BaseModel):
    """A log field declared by a service during handshake."""
    key:   str
    label: str
    type:  str   # number_entry | number | text | body | title | tags | level
    unit:   Optional[str] = None     # display unit, e.g. "V", "uA"
    metric: bool = False             # expose in Infography (number / number_entry)

class ServiceCreate(ServiceBase):
    format_ids: list[int] = []          # link these formats to the new service
    log_fields: Optional[list[DiscoverField]] = None   # auto-create log format
    elog_url: Optional[str] = None      # 프론트엔드가 window.location.origin 으로 전달

class ServiceUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    ip: Optional[str] = None
    hostname: Optional[str] = None
    directory: Optional[str] = None
    request_url: Optional[str] = None
    is_system: Optional[bool] = None
    is_subsystem: Optional[bool] = None   # legacy alias
    is_main_system: Optional[bool] = None
    max_interval_sec: Optional[int] = None
    realtime_interval_sec: Optional[float] = None
    realtime_enabled: Optional[bool] = None
    request_required: Optional[bool] = None
    is_active: Optional[bool] = None
    format_ids: Optional[list[int]] = None

class ServiceOut(ServiceBase):
    id: int
    is_main_system: bool = False
    realtime_enabled: bool
    last_request_at: Optional[datetime] = None
    next_request_at: Optional[datetime] = None
    created_at: datetime
    updated_at: datetime
    created_by: Optional[str] = None
    format_ids: list[int] = []
    format_names: list[str] = []
    # 시스템 등록 시 한 번만 반환되는 필드들
    token: Optional[str] = None                    # 생성된 API token (등록 직후만)
    credentials_sent: Optional[bool] = None        # credentials 전송 성공 여부
    credentials_error: Optional[str] = None        # 전송 실패 시 오류 메시지

    class Config:
        from_attributes = True

