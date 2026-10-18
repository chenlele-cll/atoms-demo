"""Private deployment metadata and EnvironmentFile handling; no shell sourcing."""
import hashlib
import json
import os
from pathlib import Path
import re
import stat
from uuid import uuid4


class DeploymentFault(Exception):
    def __init__(self, code):
        self.code = code
        super().__init__(code)


def digest(value):
    return hashlib.sha256(value).hexdigest()


def regular(path, required=True):
    path = Path(path)
    try:
        info = path.lstat()
    except FileNotFoundError:
        if required:
            raise DeploymentFault("MISSING_FILE") from None
        return False
    if not stat.S_ISREG(info.st_mode):
        raise DeploymentFault("UNSAFE_PATH")
    return True


def directory(path, mode=0o700):
    path = Path(path)
    path.mkdir(parents=True, exist_ok=True, mode=mode)
    if not path.is_dir() or path.is_symlink():
        raise DeploymentFault("UNSAFE_PATH")
    return path


def atomic_write(path, data, mode=0o600):
    path = Path(path)
    regular(path, required=False)
    temp = path.with_name(path.name + "." + str(uuid4()) + ".tmp")
    try:
        with temp.open("xb") as output:
            os.chmod(temp, mode)
            output.write(data)
            output.flush()
            os.fsync(output.fileno())
        os.replace(temp, path)
    finally:
        temp.unlink(missing_ok=True)


def read_json(path, optional=False):
    if optional and not regular(path, required=False):
        return None
    regular(path)
    try:
        if Path(path).stat().st_size > 2 * 1024 * 1024:
            raise ValueError
        value = json.loads(Path(path).read_text())
        if not isinstance(value, dict):
            raise ValueError
        return value
    except (ValueError, UnicodeError):
        raise DeploymentFault("INVALID_STATE") from None


def write_json(path, value):
    atomic_write(path, (json.dumps(value, sort_keys=True, indent=2) + "\n").encode())


def parse_environment(data):
    """Accept generated JSON-quoted values and ordinary single-line env files.

    Complex shell/systemd continuations are rejected rather than reinterpreted.
    Unknown keys are retained; tools never execute values from this mapping.
    """
    if len(data) > 65536:
        raise DeploymentFault("INVALID_ENVIRONMENT")
    result = {}
    try:
        for raw in data.decode("utf-8").splitlines():
            line = raw.strip()
            if not line or line.startswith(("#", ";")):
                continue
            match = re.fullmatch(r"([A-Z_][A-Z0-9_]*)=(.*)", line)
            if not match:
                raise ValueError
            key, value = match.groups()
            if value.startswith('"'):
                value = json.loads(value)
            elif value.startswith("'"):
                if not value.endswith("'") or "'" in value[1:-1]:
                    raise ValueError
                value = value[1:-1]
            elif any(char.isspace() or char in "'\"\\" for char in value):
                raise ValueError
            if not isinstance(value, str) or any(ord(char) < 32 for char in value):
                raise ValueError
            if key in result:
                raise ValueError
            result[key] = value
        return result
    except (ValueError, UnicodeError):
        raise DeploymentFault("INVALID_ENVIRONMENT") from None


def environment_bytes(values):
    for key, value in values.items():
        if not re.fullmatch(r"[A-Z_][A-Z0-9_]*", key) or not isinstance(value, str) or any(ord(c) < 32 for c in value):
            raise DeploymentFault("INVALID_ENVIRONMENT")
    return ("\n".join(key + "=" + json.dumps(values[key], ensure_ascii=False) for key in sorted(values)) + "\n").encode()
