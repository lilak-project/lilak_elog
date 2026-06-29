"""
Database setup: SQLAlchemy engine, session factory, FTS5 virtual table.
데이터는 data/{experiment}/ 에 분리 보관.
"""

import os
import shutil
import sqlite3

from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker, DeclarativeBase

# ── Data directory configuration ─────────────────────────────────────────────
_BASE_DIR = os.path.dirname(os.path.abspath(__file__))

# Root of all experiment data folders (parent of all EXPERIMENT subdirs)
DATA_ROOT = os.path.abspath(
    os.environ.get("ELOG_DATA_ROOT", os.path.join(_BASE_DIR, "..", "data"))
)

EXPERIMENT = os.environ.get("ELOG_EXPERIMENT", "default")
DATA_DIR = os.path.abspath(
    os.environ.get(
        "ELOG_DATA_DIR",
        # Must derive from DATA_ROOT — the launcher passes ELOG_DATA_ROOT
        # (not ELOG_DATA_DIR) to spawned project servers.
        os.path.join(DATA_ROOT, EXPERIMENT),
    )
)

DB_PATH   = os.path.join(DATA_DIR, "elog.db")
UPLOAD_DIR = os.path.join(DATA_DIR, "uploads")

os.makedirs(DATA_DIR,   exist_ok=True)
os.makedirs(UPLOAD_DIR, exist_ok=True)


class Base(DeclarativeBase):
    pass


engine = create_engine(
    f"sqlite:///{DB_PATH}",
    connect_args={"check_same_thread": False},
    echo=False,
)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


@event.listens_for(engine, "connect")
def _set_sqlite_pragmas(dbapi_conn, _rec):
    cur = dbapi_conn.cursor()
    cur.execute("PRAGMA journal_mode=WAL")
    cur.execute("PRAGMA foreign_keys=ON")
    cur.close()


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def _init_fts(db_path: str) -> None:
    """Create FTS5 virtual table and triggers."""
    conn = sqlite3.connect(db_path)
    c = conn.cursor()

    c.execute("""
        CREATE VIRTUAL TABLE IF NOT EXISTS log_fts USING fts5(
            title, body,
            content='log_entries',
            content_rowid='id'
        )
    """)
    c.execute("""
        CREATE TRIGGER IF NOT EXISTS log_entries_ai
        AFTER INSERT ON log_entries BEGIN
            INSERT INTO log_fts(rowid, title, body)
            VALUES (new.id, new.title, COALESCE(new.body, ''));
        END
    """)
    c.execute("""
        CREATE TRIGGER IF NOT EXISTS log_entries_ad
        AFTER DELETE ON log_entries BEGIN
            INSERT INTO log_fts(log_fts, rowid, title, body)
            VALUES ('delete', old.id, old.title, COALESCE(old.body, ''));
        END
    """)
    c.execute("""
        CREATE TRIGGER IF NOT EXISTS log_entries_bu
        BEFORE UPDATE ON log_entries BEGIN
            INSERT INTO log_fts(log_fts, rowid, title, body)
            VALUES ('delete', old.id, old.title, COALESCE(old.body, ''));
        END
    """)
    c.execute("""
        CREATE TRIGGER IF NOT EXISTS log_entries_au
        AFTER UPDATE ON log_entries BEGIN
            INSERT INTO log_fts(rowid, title, body)
            VALUES (new.id, new.title, COALESCE(new.body, ''));
        END
    """)

    conn.commit()
    conn.close()


def _try_add_column(c, sql: str) -> None:
    """Execute an ALTER TABLE ADD COLUMN, ignoring 'duplicate column' errors from concurrent workers."""
    try:
        c.execute(sql)
    except sqlite3.OperationalError as e:
        if "duplicate column name" not in str(e):
            raise


def _migrate_columns(db_path: str) -> None:
    """Add new columns to existing tables without losing data."""
    conn = sqlite3.connect(db_path)
    c = conn.cursor()

    c.execute("PRAGMA table_info(log_entries)")
    existing = {row[1] for row in c.fetchall()}

    if "run_number_type" not in existing:
        _try_add_column(c, "ALTER TABLE log_entries ADD COLUMN run_number_type VARCHAR(16) NOT NULL DEFAULT 'single'")
    if "run_number_text" not in existing:
        _try_add_column(c, "ALTER TABLE log_entries ADD COLUMN run_number_text VARCHAR(256)")
    if "format_id" not in existing:
        _try_add_column(c, "ALTER TABLE log_entries ADD COLUMN format_id INTEGER")
    if "format_fields_json" not in existing:
        _try_add_column(c, "ALTER TABLE log_entries ADD COLUMN format_fields_json TEXT")
    if "is_notice" not in existing:
        _try_add_column(c, "ALTER TABLE log_entries ADD COLUMN is_notice BOOLEAN NOT NULL DEFAULT 0")

    # ── Phase 1a: rename severity → level, add run_type, parent_log_id ────────
    # SQLite 3.25+ supports column rename. Older versions need add-and-copy.
    if "level" not in existing:
        if "severity" in existing:
            try:
                c.execute("ALTER TABLE log_entries RENAME COLUMN severity TO level")
                existing.discard("severity")
                existing.add("level")
            except sqlite3.OperationalError:
                # Fallback for older sqlite: keep severity, add level, copy data.
                _try_add_column(c, "ALTER TABLE log_entries ADD COLUMN level VARCHAR(16) DEFAULT 'info'")
                try:
                    c.execute("UPDATE log_entries SET level = severity WHERE level IS NULL")
                except sqlite3.OperationalError:
                    pass
                existing.add("level")
        else:
            _try_add_column(c, "ALTER TABLE log_entries ADD COLUMN level VARCHAR(16) DEFAULT 'info'")
            existing.add("level")
    if "run_type" not in existing:
        _try_add_column(c, "ALTER TABLE log_entries ADD COLUMN run_type VARCHAR(8)")
    if "parent_log_id" not in existing:
        _try_add_column(c, "ALTER TABLE log_entries ADD COLUMN parent_log_id INTEGER REFERENCES log_entries(id) ON DELETE SET NULL")
    # Registered task logs: lifecycle + auto-module backing.
    if "task_status" not in existing:
        _try_add_column(c, "ALTER TABLE log_entries ADD COLUMN task_status VARCHAR(16)")
    if "task_module" not in existing:
        _try_add_column(c, "ALTER TABLE log_entries ADD COLUMN task_module VARCHAR(128)")
    if "task_interval_min" not in existing:
        _try_add_column(c, "ALTER TABLE log_entries ADD COLUMN task_interval_min INTEGER")
    if "task_service_id" not in existing:
        _try_add_column(c, "ALTER TABLE log_entries ADD COLUMN task_service_id INTEGER")
    if "beam" not in existing:
        _try_add_column(c, "ALTER TABLE log_entries ADD COLUMN beam VARCHAR(128)")
    if "target" not in existing:
        _try_add_column(c, "ALTER TABLE log_entries ADD COLUMN target VARCHAR(128)")

    # Phase 5: per-run counter "(N)" used in composed titles.
    if "run_log_index" not in existing:
        _try_add_column(c, "ALTER TABLE log_entries ADD COLUMN run_log_index INTEGER")
        # Backfill: number existing rows in created_at order, per run_number.
        try:
            c.execute("""
                UPDATE log_entries
                   SET run_log_index = (
                     SELECT COUNT(*) + 1 FROM log_entries AS le2
                      WHERE le2.run_number = log_entries.run_number
                        AND log_entries.run_number IS NOT NULL
                        AND (le2.created_at < log_entries.created_at
                             OR (le2.created_at = log_entries.created_at
                                 AND le2.id < log_entries.id))
                   )
                 WHERE run_log_index IS NULL AND run_number IS NOT NULL
            """)
        except sqlite3.OperationalError:
            pass

    # Phase 2: per-experiment log_index ("#42")
    if "log_index" not in existing:
        _try_add_column(c, "ALTER TABLE log_entries ADD COLUMN log_index INTEGER")
        # Backfill: number existing rows in created_at order.
        try:
            c.execute("""
                UPDATE log_entries
                   SET log_index = (
                     SELECT COUNT(*) + 1 FROM log_entries AS le2
                      WHERE le2.created_at < log_entries.created_at
                         OR (le2.created_at = log_entries.created_at AND le2.id < log_entries.id)
                   )
                 WHERE log_index IS NULL
            """)
        except sqlite3.OperationalError:
            pass

    # chat_messages reply columns
    c.execute("PRAGMA table_info(chat_messages)")
    chat_existing = {row[1] for row in c.fetchall()}
    if "reply_to_id" not in chat_existing:
        _try_add_column(c, "ALTER TABLE chat_messages ADD COLUMN reply_to_id INTEGER REFERENCES chat_messages(id) ON DELETE SET NULL")
    if "reply_to_author" not in chat_existing:
        _try_add_column(c, "ALTER TABLE chat_messages ADD COLUMN reply_to_author VARCHAR(128)")
    if "reply_to_body" not in chat_existing:
        _try_add_column(c, "ALTER TABLE chat_messages ADD COLUMN reply_to_body VARCHAR(200)")
    if "is_system" not in chat_existing:
        _try_add_column(c, "ALTER TABLE chat_messages ADD COLUMN is_system BOOLEAN NOT NULL DEFAULT 0")
    if "is_ai_response" not in chat_existing:
        _try_add_column(c, "ALTER TABLE chat_messages ADD COLUMN is_ai_response BOOLEAN NOT NULL DEFAULT 0")
    if "external_source" not in chat_existing:
        _try_add_column(c, "ALTER TABLE chat_messages ADD COLUMN external_source VARCHAR(32)")
    if "external_author" not in chat_existing:
        _try_add_column(c, "ALTER TABLE chat_messages ADD COLUMN external_author VARCHAR(128)")

    # community_bridges: optional bot token for managed relay subprocess
    try:
        c.execute("PRAGMA table_info(community_bridges)")
        cb_existing = {row[1] for row in c.fetchall()}
        if cb_existing and "bot_token" not in cb_existing:
            _try_add_column(c, "ALTER TABLE community_bridges ADD COLUMN bot_token VARCHAR(256)")
    except sqlite3.OperationalError:
        pass

    # tags: per-tag color
    try:
        c.execute("PRAGMA table_info(tags)")
        tag_cols = {row[1] for row in c.fetchall()}
        if tag_cols and "color" not in tag_cols:
            _try_add_column(c, "ALTER TABLE tags ADD COLUMN color VARCHAR(16)")
        if tag_cols and "border_color" not in tag_cols:
            _try_add_column(c, "ALTER TABLE tags ADD COLUMN border_color VARCHAR(16)")
        if tag_cols and "text_color" not in tag_cols:
            _try_add_column(c, "ALTER TABLE tags ADD COLUMN text_color VARCHAR(16)")
    except sqlite3.OperationalError:
        pass

    # log_formats community notification flag
    c.execute("PRAGMA table_info(log_formats)")
    fmt_existing = {row[1] for row in c.fetchall()}
    if "notify_community" not in fmt_existing:
        _try_add_column(c, "ALTER TABLE log_formats ADD COLUMN notify_community BOOLEAN NOT NULL DEFAULT 0")
    # Phase 1a: format_type / task_type / run_type_lock
    if "format_type" not in fmt_existing:
        _try_add_column(c, "ALTER TABLE log_formats ADD COLUMN format_type VARCHAR(16) NOT NULL DEFAULT 'user'")
    if "task_type" not in fmt_existing:
        _try_add_column(c, "ALTER TABLE log_formats ADD COLUMN task_type VARCHAR(32)")
    if "run_type_lock" not in fmt_existing:
        _try_add_column(c, "ALTER TABLE log_formats ADD COLUMN run_type_lock VARCHAR(8)")
    if "task_template_json" not in fmt_existing:
        _try_add_column(c, "ALTER TABLE log_formats ADD COLUMN task_template_json TEXT")
    # Fix: seeded system formats may have been backfilled with 'user' default — correct them.
    try:
        c.execute("""
            UPDATE log_formats
            SET format_type = 'system'
            WHERE format_type = 'user'
              AND task_type IN ('init_of_run','start_of_run','end_of_run','monitoring_run')
        """)
    except Exception:
        pass
    # Phase 3: link from auto-generated subsystem formats back to their service.
    if "subsystem_id" not in fmt_existing:
        _try_add_column(c, "ALTER TABLE log_formats ADD COLUMN subsystem_id INTEGER REFERENCES services(id) ON DELETE SET NULL")
    # Rename: system_id is the new name for subsystem_id (additive migration).
    if "system_id" not in fmt_existing:
        _try_add_column(c, "ALTER TABLE log_formats ADD COLUMN system_id INTEGER REFERENCES services(id) ON DELETE SET NULL")
        try:
            c.execute("UPDATE log_formats SET system_id = subsystem_id WHERE subsystem_id IS NOT NULL AND system_id IS NULL")
        except Exception:
            pass

    # services: is_system (renamed from is_subsystem, kept additive)
    try:
        c.execute("PRAGMA table_info(services)")
        svc_existing = {row[1] for row in c.fetchall()}
        if svc_existing and "is_system" not in svc_existing:
            _try_add_column(c, "ALTER TABLE services ADD COLUMN is_system BOOLEAN NOT NULL DEFAULT 0")
            try:
                c.execute("UPDATE services SET is_system = is_subsystem WHERE is_subsystem = 1")
            except Exception:
                pass
        # hostname: preferred replacement for ip (additive — ip column kept)
        if svc_existing and "hostname" not in svc_existing:
            _try_add_column(c, "ALTER TABLE services ADD COLUMN hostname VARCHAR(256)")
            try:
                c.execute("UPDATE services SET hostname = ip WHERE ip IS NOT NULL AND hostname IS NULL")
            except Exception:
                pass
        # request_required: controls whether auto-requests are sent
        if svc_existing and "request_required" not in svc_existing:
            _try_add_column(c, "ALTER TABLE services ADD COLUMN request_required BOOLEAN NOT NULL DEFAULT 1")
        # is_main_system: exactly one service may be the top-level "main system"
        if svc_existing and "is_main_system" not in svc_existing:
            _try_add_column(c, "ALTER TABLE services ADD COLUMN is_main_system BOOLEAN NOT NULL DEFAULT 0")
    except sqlite3.OperationalError:
        pass

    # infographs: multi-variable + histogram bin columns
    try:
        c.execute("PRAGMA table_info(infographs)")
        ig_existing = {row[1] for row in c.fetchall()}
        if ig_existing:
            for col, ddl in (("x_vars", "TEXT"), ("y_vars", "TEXT"),
                             ("n_bins", "INTEGER"), ("x_min", "REAL"), ("x_max", "REAL"),
                             ("infograph_index", "INTEGER"), ("tags", "TEXT"),
                             ("run", "INTEGER"), ("source", "VARCHAR(128)"),
                             ("run_spec", "TEXT"), ("y_min", "REAL"), ("y_max", "REAL"),
                             ("log_y", "BOOLEAN NOT NULL DEFAULT 0")):
                if col not in ig_existing:
                    _try_add_column(c, f"ALTER TABLE infographs ADD COLUMN {col} {ddl}")
            # Backfill sequential infograph_index by id order.
            if "infograph_index" not in ig_existing:
                try:
                    c.execute("""
                        UPDATE infographs SET infograph_index = (
                          SELECT COUNT(*) FROM infographs AS i2 WHERE i2.id <= infographs.id
                        ) WHERE infograph_index IS NULL
                    """)
                except sqlite3.OperationalError:
                    pass
    except sqlite3.OperationalError:
        pass

    # users: new optional fields
    try:
        c.execute("PRAGMA table_info(users)")
        u_existing = {row[1] for row in c.fetchall()}
        if u_existing:
            if "phone" not in u_existing:
                _try_add_column(c, "ALTER TABLE users ADD COLUMN phone VARCHAR(64)")
            if "participation_from" not in u_existing:
                _try_add_column(c, "ALTER TABLE users ADD COLUMN participation_from VARCHAR(10)")
            if "participation_to" not in u_existing:
                _try_add_column(c, "ALTER TABLE users ADD COLUMN participation_to VARCHAR(10)")
            if "experiment_role" not in u_existing:
                _try_add_column(c, "ALTER TABLE users ADD COLUMN experiment_role VARCHAR(64)")
            if "profile_color" not in u_existing:
                _try_add_column(c, "ALTER TABLE users ADD COLUMN profile_color VARCHAR(16)")
            if "profile_shape" not in u_existing:
                _try_add_column(c, "ALTER TABLE users ADD COLUMN profile_shape VARCHAR(32)")
            if "preferences_json" not in u_existing:
                _try_add_column(c, "ALTER TABLE users ADD COLUMN preferences_json TEXT")
            if "portal_linked" not in u_existing:
                _try_add_column(c, "ALTER TABLE users ADD COLUMN portal_linked BOOLEAN NOT NULL DEFAULT 0")
    except sqlite3.OperationalError:
        pass

    # shift_patterns: effective date range
    try:
        c.execute("PRAGMA table_info(shift_patterns)")
        sp_existing = {row[1] for row in c.fetchall()}
        if sp_existing:
            if "effective_from" not in sp_existing:
                _try_add_column(c, "ALTER TABLE shift_patterns ADD COLUMN effective_from VARCHAR(10)")
            if "effective_to" not in sp_existing:
                _try_add_column(c, "ALTER TABLE shift_patterns ADD COLUMN effective_to VARCHAR(10)")
    except sqlite3.OperationalError:
        pass

    # modules table (built-in elog data collectors)
    try:
        c.execute("PRAGMA table_info(modules)")
        mod_existing = {row[1] for row in c.fetchall()}
        if not mod_existing:
            c.execute("""
                CREATE TABLE IF NOT EXISTS modules (
                    id           VARCHAR(64) PRIMARY KEY,
                    enabled      BOOLEAN NOT NULL DEFAULT 0,
                    interval_sec INTEGER NOT NULL DEFAULT 60
                )
            """)
    except sqlite3.OperationalError:
        pass

    conn.commit()
    conn.close()


def _migrate_old_data() -> None:
    """기존 backend/elog.db 와 uploads/ 를 새 data 폴더로 자동 이전.
    default 실험에서만 실행 — 다른 실험 시작 시 불필요한 복사 방지."""
    if EXPERIMENT != 'default':
        return

    old_db      = os.path.join(_BASE_DIR, "elog.db")
    old_uploads = os.path.join(_BASE_DIR, "uploads")

    if os.path.exists(old_db) and not os.path.exists(DB_PATH):
        shutil.copy2(old_db, DB_PATH)
        print(f"⚡ DB migrated: {old_db} → {DB_PATH}")

    if os.path.isdir(old_uploads) and not os.listdir(UPLOAD_DIR):
        for item in os.listdir(old_uploads):
            src = os.path.join(old_uploads, item)
            dst = os.path.join(UPLOAD_DIR, item)
            if os.path.isdir(src):
                shutil.copytree(src, dst)
            else:
                shutil.copy2(src, dst)
        print(f"⚡ Uploads migrated: {old_uploads} → {UPLOAD_DIR}")


def _import_users_from_default(db) -> bool:
    """새 실험 DB가 비어 있을 때 default 실험의 사용자를 복사한다."""
    default_db_path = os.path.join(DATA_ROOT, 'default', 'elog.db')
    if not os.path.exists(default_db_path) or default_db_path == DB_PATH:
        return False
    try:
        conn = sqlite3.connect(default_db_path)
        rows = conn.execute(
            "SELECT username, display_name, email, role, password_hash, is_active "
            "FROM users WHERE is_active = 1"
        ).fetchall()
        conn.close()
        if not rows:
            return False
        from models import User
        for username, display_name, email, role, password_hash, is_active in rows:
            if not db.query(User).filter(User.username == username).first():
                db.add(User(
                    username=username,
                    display_name=display_name,
                    email=email,
                    role=role,
                    password_hash=password_hash,
                    is_active=bool(is_active),
                ))
        db.commit()
        print(f"⚡ Imported {len(rows)} user(s) from default experiment")
        return True
    except Exception as e:
        print(f"⚠ Could not import users from default: {e}")
        return False


def init_db() -> None:
    """Create tables, FTS, upload dir, and default manager account."""
    _migrate_old_data()

    from models import Base as _Base, User
    from auth import hash_password

    _Base.metadata.create_all(bind=engine)
    _init_fts(DB_PATH)
    _migrate_columns(DB_PATH)

    db = SessionLocal()
    try:
        fresh_experiment = db.query(User).count() == 0
        if fresh_experiment:
            # 새 실험이면 default 사용자를 가져온다
            imported = _import_users_from_default(db)
            if not imported:
                admin = User(
                    username="admin",
                    display_name="Admin",
                    email="",
                    role="manager",
                    password_hash=hash_password("1757"),
                    is_active=True,
                )
                db.add(admin)
                db.commit()
                print("⚡ Created default manager account: admin / 1757")
            # New project: hide the Schedule tab by default (manager can re-enable
            # it from Settings). Only seeded for a brand-new experiment so existing
            # projects keep whatever they had.
            from settings_store import get_setting, set_setting
            if get_setting(db, "tabs_disabled", None) is None:
                set_setting(db, "tabs_disabled", ["schedule"])
                print("⚡ New experiment: Schedule tab hidden by default")
        # Phase 3: seed the canonical formats (Standard / Init / Start / End /
        # Monitoring). Idempotent per format, so upgraded DBs get any canonical
        # format they're missing while keeping their existing ones.
        from seed_formats import seed_default_formats, ensure_time_metric_on_run_formats, remove_beam_target_from_standard
        import json as _json
        import models as models  # noqa: PLW0127
        n_seeded = seed_default_formats(db)
        if n_seeded:
            print(f"⚡ Seeded {n_seeded} built-in log formats")
        # Ensure run-flow formats expose the `time` metric (also upgrades old DBs).
        n_time = ensure_time_metric_on_run_formats(db)
        if n_time:
            print(f"⚡ Added time metric to {n_time} run formats")
        # beam/target live in their own setter formats, not Standard.
        n_bt = remove_beam_target_from_standard(db)
        if n_bt:
            print(f"⚡ Removed beam/target from {n_bt} Standard format(s)")
        # Migration: add init_of_run format if missing (added after initial seed)
        existing_init = db.query(models.LogFormat).filter(
            models.LogFormat.task_type == "init_of_run",
            models.LogFormat.system_id.is_(None),
        ).first()
        if not existing_init:
            from seed_formats import _run_fields
            init_fmt = models.LogFormat(
                name="Init of run log",
                fields_json=_json.dumps(_run_fields(run_builtin="run")),
                is_default=False,
                format_type="system",
                task_type="init_of_run",
                run_type_lock="I",
                created_by="<system:migrate>",
            )
            db.add(init_fmt)
            db.commit()
            print("⚡ Added init_of_run format")
    finally:
        db.close()


def _seed_run_formats(db) -> None:  # noqa: ARG001
    """DEPRECATED — superseded by seed_formats.seed_default_formats (Phase 3).
    Kept as a no-op shim in case external callers / tests still import it."""
    return

def _seed_run_formats_legacy(db) -> None:
    """The old Phase-0 seeder. No longer called from init_db; preserved here
    only for documentation. Use seed_formats.seed_default_formats instead."""
    import json as _json
    from models import LogFormat

    def _ensure(name: str, fields: list):
        if db.query(LogFormat).filter(LogFormat.name == name).first():
            return
        db.add(LogFormat(
            name=name,
            fields_json=_json.dumps(fields),
            is_default=False,
            notify_community=False,
            created_by="system",
        ))

    start_fields = [
        {"key": "run_number",  "label": "Run Number",  "field_type": "builtin",
         "builtin_id": "run_number",  "required": True,  "order": 0},
        {"key": "title",       "label": "Title",       "field_type": "builtin",
         "builtin_id": "title",       "required": True,  "order": 1},
        {"key": "category",    "label": "Category",    "field_type": "builtin",
         "builtin_id": "category",    "required": False, "order": 2},
        {"key": "data_type",   "label": "Data Type",   "field_type": "text",
         "placeholder": "physics / calibration / cosmic …", "required": False, "order": 3},
        {"key": "tags",        "label": "Tags",        "field_type": "builtin",
         "builtin_id": "tags",        "required": False, "order": 4},
        {"key": "body",        "label": "Notes",       "field_type": "builtin",
         "builtin_id": "body",        "required": False, "order": 5},
    ]
    end_fields = [
        {"key": "run_number",  "label": "Run Number",  "field_type": "builtin",
         "builtin_id": "run_number",  "required": True,  "order": 0},
        {"key": "title",       "label": "Title",       "field_type": "builtin",
         "builtin_id": "title",       "required": True,  "order": 1},
        {"key": "category",    "label": "Category",    "field_type": "builtin",
         "builtin_id": "category",    "required": False, "order": 2},
        {"key": "n_events",    "label": "Events Collected", "field_type": "number",
         "placeholder": "0", "required": False, "order": 3},
        {"key": "result",      "label": "Result",      "field_type": "text",
         "placeholder": "good / bad / unstable …", "required": False, "order": 4},
        {"key": "body",        "label": "Summary",     "field_type": "builtin",
         "builtin_id": "body",        "required": False, "order": 5},
    ]
    _ensure("Start of Run", start_fields)
    _ensure("End of Run",   end_fields)
    db.commit()


def next_log_index(db) -> int:
    """Next log_index for a new entry.

    Monotonic and stable: max log_index across ALL rows (including soft-deleted)
    + 1. Numbers are never reused or renumbered after deletions, so a log keeps
    the same number for its whole life and references to it stay valid.
    """
    import models
    from sqlalchemy import func
    return (db.query(func.coalesce(func.max(models.LogEntry.log_index), 0)).scalar() or 0) + 1
