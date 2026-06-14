"""
Manage the discord_relay.py subprocess from inside the FastAPI backend.

Design:
  • One bridge → one subprocess. PID + log file live next to the project so
    every uvicorn worker can read them (filesystem is the source of truth).
  • Start: write the bridge's bot_token + lilak incoming URL into the
    subprocess environment, spawn detached.
  • Stop: read PID, SIGTERM, wait up to 5 s, SIGKILL if still alive.
  • Status: ping the PID with signal 0.

Multi-worker safety: we never assume "this worker started it". Start checks
liveness first; Stop reads the PID file each call.
"""

from __future__ import annotations

import os
import signal
import subprocess
import time
from pathlib import Path
from typing import Optional


# Project root = .../backend/services → ../..
_ROOT = Path(__file__).resolve().parent.parent.parent
_RUNTIME_DIR = _ROOT / "data" / "_runtime"
_RUNTIME_DIR.mkdir(parents=True, exist_ok=True)

# We reuse the venv interpreter that's running uvicorn, so deps match.
_PYTHON = _ROOT / ".venv" / "bin" / "python"
_RELAY_SCRIPT = _ROOT / "discord_relay.py"


def _pid_file(bridge_id: int) -> Path:
    return _RUNTIME_DIR / f"discord_relay_{bridge_id}.pid"


def _log_file(bridge_id: int) -> Path:
    return _RUNTIME_DIR / f"discord_relay_{bridge_id}.log"


def _alive(pid: int) -> bool:
    """Return True if a process with this PID is alive."""
    try:
        os.kill(pid, 0)
        return True
    except (ProcessLookupError, PermissionError):
        return False
    except OSError:
        return False


def get_status(bridge_id: int) -> dict:
    """Return current status snapshot: { running, pid, log_tail }."""
    pf = _pid_file(bridge_id)
    pid: Optional[int] = None
    running = False
    if pf.exists():
        try:
            pid = int(pf.read_text().strip())
            running = _alive(pid)
        except (ValueError, OSError):
            pid = None
    if not running and pf.exists():
        # PID file is stale — clean up so next start doesn't think we're alive
        try: pf.unlink()
        except OSError: pass
        pid = None

    log_tail = ""
    lf = _log_file(bridge_id)
    if lf.exists():
        try:
            data = lf.read_bytes()
            # Keep last ~2KB
            log_tail = data[-2000:].decode("utf-8", errors="replace")
        except OSError:
            pass

    return {"running": running, "pid": pid, "log_tail": log_tail}


def start(bridge_id: int, bot_token: str, lilak_incoming_url: str,
          channel_ids: str = "") -> dict:
    """Spawn discord_relay.py for this bridge. No-op if already running."""
    st = get_status(bridge_id)
    if st["running"]:
        return {"ok": True, "already_running": True, "pid": st["pid"]}

    if not _PYTHON.exists():
        return {"ok": False, "error": f"python not found at {_PYTHON}"}
    if not _RELAY_SCRIPT.exists():
        return {"ok": False, "error": f"relay script missing: {_RELAY_SCRIPT}"}
    if not bot_token:
        return {"ok": False, "error": "bot_token not set"}
    if not lilak_incoming_url:
        return {"ok": False, "error": "lilak incoming URL not set (enable Incoming first)"}

    env = os.environ.copy()
    env["DISCORD_BOT_TOKEN"]  = bot_token
    env["LILAK_INCOMING_URL"] = lilak_incoming_url
    if channel_ids:
        env["DISCORD_CHANNEL_IDS"] = channel_ids

    # Open log in append mode so manual restarts share history.
    log_fp = open(_log_file(bridge_id), "ab")
    try:
        proc = subprocess.Popen(
            [str(_PYTHON), str(_RELAY_SCRIPT)],
            cwd=str(_ROOT),
            env=env,
            stdout=log_fp,
            stderr=subprocess.STDOUT,
            stdin=subprocess.DEVNULL,
            start_new_session=True,   # detach from FastAPI's process group
        )
    except Exception as e:
        log_fp.close()
        return {"ok": False, "error": f"spawn failed: {e}"}
    finally:
        # The child inherits the fd; we close our copy.
        try: log_fp.close()
        except Exception: pass

    # Give the child a beat to actually start and (often) crash if creds are bad
    time.sleep(0.3)
    if proc.poll() is not None:
        # Child already exited
        st = get_status(bridge_id)
        return {"ok": False, "error": "process exited immediately — check log",
                "log_tail": st["log_tail"]}

    _pid_file(bridge_id).write_text(str(proc.pid))
    return {"ok": True, "pid": proc.pid}


def stop(bridge_id: int) -> dict:
    """SIGTERM the running relay (if any). Wait up to 5 s then SIGKILL."""
    st = get_status(bridge_id)
    if not st["running"]:
        # Clean up any stale PID file just in case
        try: _pid_file(bridge_id).unlink()
        except OSError: pass
        return {"ok": True, "already_stopped": True}

    pid = st["pid"]
    try:
        os.kill(pid, signal.SIGTERM)
    except ProcessLookupError:
        try: _pid_file(bridge_id).unlink()
        except OSError: pass
        return {"ok": True, "already_stopped": True}

    # Wait for graceful exit
    for _ in range(50):
        time.sleep(0.1)
        if not _alive(pid):
            break
    else:
        # Still alive — escalate
        try:
            os.kill(pid, signal.SIGKILL)
        except ProcessLookupError:
            pass

    try: _pid_file(bridge_id).unlink()
    except OSError: pass
    return {"ok": True, "stopped_pid": pid}
