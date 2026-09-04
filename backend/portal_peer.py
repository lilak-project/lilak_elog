"""Resolve `portal://<service>/<path>` service URLs at call time.

A portal-managed service does not have a fixed address. The LILAK portal picks
its port out of a pool when it starts (service_manager `reserve_port`) and
records it in `<PORTAL_DATA_ROOT>/<service>/.port`; the file is cleared when the
process dies, and the next start takes whatever is free -- usually the same
number, but nothing guarantees it. So a `request_url` of
`http://127.0.0.1:8029/api/elog` is right until something restarts in a
different order, and then it silently points at another service.

Going through the portal's own proxy (`<portal>/p/<service>/…`) is not an
option either: that path is gated on a portal session (proxy.py `_guard`), and
a webhook carries no user.

Hence this scheme. `portal://hv/api/elog` is resolved to loopback **per call**,
so a restart on either side needs no re-registration:

    portal://hv/api/elog            ->  http://127.0.0.1:8029/api/elog
    portal://elog:KO2520/api/logs   ->  http://127.0.0.1:8030/api/logs

The second form addresses ONE PROJECT of a multi-project service, whose port
lives at `<root>/<service>/projects/<project>/.port`. A colon separates them
because a portal service name cannot contain one, so `portal://elog:KO2520/x`
can never be confused with a service literally called `elog` reached at `/x`.

Loopback is deliberate: a portal-managed service binds 127.0.0.1 only, and both
elog and the service it is asking run on the portal's host.

Ordinary http:// and https:// URLs are returned untouched, so a service that
runs somewhere else is registered exactly as before.
"""

from __future__ import annotations

import os
import re
from pathlib import Path

SCHEME = "portal://"

#: Same shape the portal itself accepts for a service directory name.
_NAME_RE = re.compile(r"^[A-Za-z0-9_-]{1,64}$")


class PortalPeerError(Exception):
    """The scheme was used but the service could not be located."""


def is_portal_url(url: str) -> bool:
    return bool(url) and url.strip().lower().startswith(SCHEME)


def resolve(url: str) -> str:
    """`portal://<service>/<path>` -> a loopback URL. Anything else is returned as is.

    Raises PortalPeerError when the scheme is used but the service is not
    registered or not running -- which is the ordinary case for a service that
    is simply stopped, and the caller turns it into the same "did not answer"
    message any other unreachable service produces.
    """
    if not is_portal_url(url):
        return url

    rest = url.strip()[len(SCHEME):]
    address, separator, path = rest.partition("/")
    name, _colon, project = address.partition(":")
    if not _NAME_RE.match(name):
        raise PortalPeerError(f"'{name}' is not a valid portal service name")
    if project and not _NAME_RE.match(project):
        raise PortalPeerError(f"'{project}' is not a valid portal project name")

    root = os.environ.get("PORTAL_DATA_ROOT")
    if not root:
        raise PortalPeerError(
            "portal:// needs PORTAL_DATA_ROOT, which the portal sets when it "
            "starts a service. This elog was not started by the portal, so it "
            "cannot look up another service's port -- register the service with "
            "an http:// address instead."
        )

    service_dir = Path(root) / name
    if project:
        service_dir = service_dir / "projects" / project
    port_file = service_dir / ".port"
    try:
        port = int(port_file.read_text().strip())
    except FileNotFoundError:
        raise PortalPeerError(
            f"'{address}' is not running (no {port_file}). Start it in the portal."
        ) from None
    except (OSError, ValueError) as err:
        raise PortalPeerError(f"cannot read {port_file}: {err}") from err

    # The portal records the PID beside the port and clears both when it next
    # notices the process is gone -- but "next notices" is lazy, so between a
    # service dying and anyone looking, `.port` still names a port nothing is
    # serving. Checking the PID here turns that window's "connection refused"
    # into the sentence that is actually true and actionable.
    pid_file = service_dir / ".pid"
    try:
        pid = int(pid_file.read_text().strip())
    except (OSError, ValueError):
        pid = None                        # nothing recorded; fall through and try
    if pid is not None and not _pid_alive(pid):
        raise PortalPeerError(
            f"'{address}' is not running (its recorded process {pid} is gone). "
            "Start it in the portal, then try again."
        )

    return f"http://127.0.0.1:{port}/{path}" if separator else f"http://127.0.0.1:{port}"


def _pid_alive(pid: int) -> bool:
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True                       # exists but not ours to signal
    except OSError:
        return False
    return True


def self_url(fallback: str = "") -> str:
    """The address to hand a SYSTEM so it can push logs back to this elog.

    A system posts to `<elog_url>/api/logs` with an elog API token. It cannot go
    through the portal to do that: `/pp/<svc>/<proj>/` is gated on a portal
    session (project_mgmt `_proxy_guard`), and an elog token is not a portal
    token -- it would be refused at the door. Nor is the browser's origin any
    use: that is the PORTAL's origin, without the `/pp/elog/<project>` prefix
    the app is actually served under, so `<origin>/api/logs` lands on the portal.

    So under the portal this returns the loopback-resolvable form, which is the
    mirror image of how this elog reaches its services. ELOG_PUBLIC_URL still
    wins when it is set -- that is how an admin points a system running on
    ANOTHER machine at a reachable address, which no loopback URL could serve.
    """
    explicit = os.environ.get("ELOG_PUBLIC_URL", "").strip()
    if explicit:
        return explicit.rstrip("/")
    service = os.environ.get("PORTAL_SERVICE", "").strip()
    if service:
        project = os.environ.get("PORTAL_PROJECT", "").strip()
        return f"{SCHEME}{service}:{project}" if project else f"{SCHEME}{service}"
    return fallback
