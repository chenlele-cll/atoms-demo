from dataclasses import dataclass, field
import re
from uuid import UUID


class InputError(Exception):
    """Only fixed, credential-free messages may cross this boundary."""


@dataclass(frozen=True)
class DeploymentIdentity:
    """Verified adapter output, never a second release manifest."""
    release_id: str
    content_digest: str = field(repr=False)
    backend_config_digest: str = field(repr=False)
    proxy_config_digest: str = field(repr=False)

    def __post_init__(self):
        try:
            UUID(self.release_id)
            for value in (self.content_digest, self.backend_config_digest, self.proxy_config_digest):
                if not isinstance(value, str) or not re.fullmatch(r"[a-f0-9]{64}", value):
                    raise ValueError
        except (ValueError, TypeError, AttributeError):
            raise InputError("Invalid verified deployment identity; values suppressed.") from None


def decide_update(current, desired, *, backend_healthy, proxy_healthy):
    """Pure policy only. Observation, artifact verification and execution are adapters."""
    if not isinstance(desired, DeploymentIdentity) or (current is not None and not isinstance(current, DeploymentIdentity)):
        raise InputError("A verified deployment identity is required.")
    if type(backend_healthy) is not bool or type(proxy_healthy) is not bool:
        raise InputError("Health must be explicitly observed, not unknown.")
    if current and current.release_id == desired.release_id and current.content_digest != desired.content_digest:
        raise InputError("Immutable release ID has conflicting content; deployment refused.")
    switch = current is None or current.release_id != desired.release_id
    backend_changed = current is None or current.backend_config_digest != desired.backend_config_digest
    proxy_changed = current is None or current.proxy_config_digest != desired.proxy_config_digest
    mode = ("install" if current is None else "activate" if switch else "configure"
            if backend_changed or proxy_changed else "repair" if not (backend_healthy and proxy_healthy) else "noop")
    restart = switch or backend_changed or not backend_healthy
    return {"mode": mode, "switch_release": switch, "restart_backend": restart,
            "reload_proxy": switch or proxy_changed or not proxy_healthy,
            "require_cold_backup_check": restart, "verify_health": True,
            "build_release": False, "restore_database": False}


