"""Small control-node adapter; Ansible owns SSH and remote inspection."""

import argparse
from dataclasses import dataclass, field
import importlib.metadata
import ipaddress
import json
import os
from pathlib import Path
import re
import signal
import stat
import subprocess
import sys
from uuid import UUID
import venv


ROOT = Path(__file__).resolve().parent.parent
TOOLS = ROOT / ".tools/deploy"
HELP = """Usage: ./deploy.sh <command> [options]

  bootstrap  Install pinned local Ansible tools (Python 3.12–3.14).
  validate   Offline playbook syntax and template rendering; no private config.
  test       Local behavior tests; no real inventory or server connections.
  plan       Offline Ansible phases and pending integrations; supports --json.
  check      Read-only server prerequisites; missing items return nonzero.
  status     Read current symlink/service states; does not certify health.
  apply      Dependency-gated framework; fails before config or SSH access.

check/status default to server.local.yml (owner-only mode 0600).
plan/apply accept --release <path> as a reserved input, not a verified package.
plan/apply --json emits a bounded framework plan; canApply remains false.
No command implicitly deploys, updates tools, or changes remote services.
See docs/engineering/deployment.md for setup and scope.
"""


class InputError(Exception):
    """Only fixed, credential-free messages may cross this boundary."""


@dataclass(frozen=True)
class DeploymentIdentity:
    """Future trusted adapter output, never a second release manifest."""
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


def framework_plan(release_provided=False):
    """Read native Ansible declarations, without inventory or artifact access."""
    import yaml

    folder = ROOT / "deploy"
    try:
        dependencies = yaml.safe_load((folder / "integrations.yml").read_text())["atoms_pending_integrations"]
        if not isinstance(dependencies, dict) or not dependencies:
            raise ValueError
        pending = []
        for key, value in dependencies.items():
            if (not re.fullmatch(r"[a-z_]+", key) or not isinstance(value, dict)
                    or set(value) != {"owner", "contract"}
                    or not re.fullmatch(r"[A-Z]{3}-[0-9]{3}", value["owner"])
                    or not isinstance(value["contract"], str) or not value["contract"].strip()):
                raise ValueError
            pending.append({"id": key, **value})
        plays = yaml.safe_load((folder / "apply.yml").read_text())
        if len(plays) != 1 or plays[0]["hosts"] != "atoms" or plays[0]["gather_facts"] is not False:
            raise ValueError
        block = plays[0]["tasks"][0]
        phases = {}
        for section in ("block", "rescue", "always"):
            phases[section] = []
            for task in block[section]:
                name, path = task["name"], task["ansible.builtin.import_tasks"]
                if not isinstance(name, str) or not isinstance(path, str):
                    raise ValueError
                target = folder / path
                if target.is_symlink() or not target.resolve().is_relative_to(folder.resolve()) or not target.is_file():
                    raise ValueError
                phases[section].append({"name": name, "task_file": path})
        return {"schemaVersion": 1, "mode": "framework", "canApply": False,
                "deploymentVerified": False, "releaseProvided": release_provided,
                "phases": phases, "pendingIntegrations": pending}
    except (OSError, ValueError, TypeError, KeyError, IndexError, yaml.YAMLError):
        raise InputError("Deployment framework declarations are invalid or incomplete; contents suppressed.") from None


def print_framework_plan(plan, as_json):
    if as_json:
        print(json.dumps(plan, ensure_ascii=False, indent=2))
        return
    print("Deployment framework plan: canApply=false, deploymentVerified=false")
    for section, phases in plan["phases"].items():
        print(section + ":")
        for phase in phases:
            print("  " + phase["name"] + " (" + phase["task_file"] + ")")
    print("Pending integrations:")
    for item in plan["pendingIntegrations"]:
        print("  " + item["id"] + " [" + item["owner"] + "]: " + item["contract"])


class Cancelled(Exception):
    def __init__(self, signum):
        self.signum = signum


def cancel(signum, _frame):
    raise Cancelled(signum)


def stop_owned_processes(process):
    try:
        import psutil
    except ImportError:
        # Initial pip bootstrap has not installed psutil yet.
        try:
            os.killpg(process.pid, signal.SIGTERM)
        except ProcessLookupError:
            pass
        return
    try:
        parent = psutil.Process(process.pid)
        children = parent.children(recursive=True)
    except psutil.NoSuchProcess:
        return
    owned = list(reversed(children)) + [parent]
    for child in owned:
        try:
            child.terminate()
        except psutil.NoSuchProcess:
            pass
    _, alive = psutil.wait_procs(owned, timeout=5)
    for child in alive:
        try:
            child.kill()
        except psutil.NoSuchProcess:
            pass


def clean_environment():
    env = {key: value for key, value in os.environ.items()
           if not key.startswith("ANSIBLE_") and key not in (
               "PYTHONPATH", "PYTHONHOME", "PYTHONINSPECT", "PYTHONSTARTUP",
               "SSH_ASKPASS", "SSH_ASKPASS_REQUIRE", "NODE_OPTIONS", "NODE_PATH")}
    env.update(ANSIBLE_CONFIG=str(ROOT / "deploy/ansible.cfg"),
               ANSIBLE_NOCOLOR="1", ANSIBLE_DEBUG="0", ANSIBLE_VERBOSITY="0",
               ANSIBLE_LOCAL_TEMP=str(ROOT / ".runtime/deploy/tmp"),
               PYTHONDONTWRITEBYTECODE="1")
    return env


def run(command, timeout=90):
    """Bounded process group; cancellation never leaves an SSH child running."""
    process = subprocess.Popen(command, cwd=ROOT, env=clean_environment(),
                               start_new_session=True)
    try:
        return process.wait(timeout=timeout)
    except (subprocess.TimeoutExpired, KeyboardInterrupt, Cancelled) as error:
        stop_owned_processes(process)
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            os.killpg(process.pid, signal.SIGKILL)
            process.wait()
        print("Deployment command cancelled or exceeded its time limit.", file=sys.stderr)
        return 128 + error.signum if isinstance(error, Cancelled) else 130 if isinstance(error, KeyboardInterrupt) else 124


def require_tools():
    try:
        pins = [line.split("==") for line in (ROOT / "deploy/requirements.txt").read_text().splitlines()
                if line and not line.startswith("#")]
        valid = all(importlib.metadata.version(name) == version for name, version in pins)
    except importlib.metadata.PackageNotFoundError:
        valid = False
    if not valid or Path(sys.prefix).resolve() != TOOLS.resolve():
        raise InputError("Run ./deploy.sh bootstrap to prepare pinned local tools.")


def inventory_path(value):
    import yaml

    class UniqueKeys(yaml.SafeLoader):
        pass

    def mapping(loader, node):
        pairs = loader.construct_pairs(node, deep=True)
        result = dict(pairs)
        if len(result) != len(pairs):
            raise InputError("Duplicate inventory keys are not allowed; contents suppressed.")
        return result

    UniqueKeys.add_constructor(yaml.resolver.BaseResolver.DEFAULT_MAPPING_TAG, mapping)
    path = Path(value).expanduser().absolute()
    try:
        info = path.lstat()
        if not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid() or stat.S_IMODE(info.st_mode) != 0o600:
            raise InputError("Inventory must be your regular, non-symlink file with mode 0600.")
        if path.suffix not in (".yml", ".yaml") or info.st_size > 65536:
            raise InputError("Inventory must be a YAML file no larger than 64 KiB.")
        if path.is_relative_to(ROOT):
            ignored = subprocess.run(["git", "check-ignore", "-q", str(path)], cwd=ROOT,
                                     stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            if ignored.returncode != 0:
                raise InputError("Repository-local private inventory must be Git-ignored.")
        data = yaml.load(path.read_text(), Loader=UniqueKeys)
        if not isinstance(data, dict) or set(data) != {"all"} or set(data["all"]) != {"hosts"} or set(data["all"]["hosts"]) != {"atoms"}:
            raise InputError("Inventory must contain only all.hosts.atoms; see server.example.")
        host = data["all"]["hosts"]["atoms"]
        allowed = {"ansible_host", "ansible_port", "ansible_user", "ansible_password",
                   "ansible_ssh_private_key_file", "atoms_https_port", "atoms_backend_port",
                   "atoms_node_binary", "atoms_pnpm_binary", "atoms_nginx_binary",
                   "atoms_tls_certificate", "atoms_tls_key"}
        if not isinstance(host, dict) or not set(host) <= allowed:
            raise InputError("Unsupported inventory fields; use the documented single-server schema.")
        if not isinstance(host["ansible_host"], str):
            raise ValueError
        ipaddress.IPv4Address(host["ansible_host"])
        if not re.fullmatch(r"[a-z_][a-z0-9_-]*", host["ansible_user"]):
            raise ValueError
        for key, default in (("ansible_port", 22), ("atoms_https_port", 8443), ("atoms_backend_port", 3001)):
            port = host.get(key, default)
            if type(port) is not int or not 1 <= port <= 65535:
                raise ValueError
        if len({host.get("ansible_port", 22), host.get("atoms_https_port", 8443), host.get("atoms_backend_port", 3001)}) != 3:
            raise ValueError
        password = host.get("ansible_password")
        key_file = host.get("ansible_ssh_private_key_file")
        if (password is None) == (key_file is None):
            raise InputError("Select exactly one authentication field: password or private key path.")
        if password is not None and (not isinstance(password, str) or not password or any(ord(c) < 32 for c in password) or "{{" in password or "{%" in password):
            raise InputError("Password must be a nonempty literal without controls or template delimiters.")
        if key_file is not None and (not isinstance(key_file, str) or not key_file.startswith(("/", "~/")) or not re.fullmatch(r"[~/a-zA-Z0-9_. -]+", key_file)):
            raise InputError("Private key must use a literal absolute or ~/ path.")
        for key in allowed - {"ansible_host", "ansible_port", "ansible_user", "ansible_password", "ansible_ssh_private_key_file", "atoms_https_port", "atoms_backend_port"}:
            if key in host:
                value = host[key]
                if not isinstance(value, str) or not re.fullmatch(r"/[a-zA-Z0-9_./-]+", value) or ".." in Path(value).parts:
                    raise ValueError
        return path
    except InputError:
        raise
    except (OSError, ValueError, TypeError, KeyError, yaml.YAMLError):
        raise InputError("Inventory is missing or invalid; contents suppressed. See server.example.") from None


def main():
    parser = argparse.ArgumentParser(add_help=False, usage=argparse.SUPPRESS)
    parser.add_argument("command", nargs="?", default="help")
    parser.add_argument("--inventory")
    parser.add_argument("--release")
    parser.add_argument("--json", action="store_true")
    parser.add_argument("-h", "--help", action="store_true")
    args, unknown = parser.parse_known_args()
    if unknown or args.command not in ("help", "bootstrap", "validate", "test", "plan", "check", "status", "apply"):
        raise InputError("Unknown command or option; run ./deploy.sh help.")
    if args.help or args.command == "help":
        print(HELP)
        return 0
    if args.inventory and args.command not in ("check", "status", "apply"):
        raise InputError("--inventory is only accepted by check/status/apply.")
    if (args.release or args.json) and args.command not in ("plan", "apply"):
        raise InputError("--release and --json are only accepted by plan/apply.")
    if args.command == "apply":
        try:
            require_tools()
        except InputError:
            raise InputError("DEP-003 framework has pending integrations; run bootstrap and plan. No inventory or artifact was read.") from None
        plan = framework_plan(bool(args.release))
        print_framework_plan(plan, args.json)
        raise InputError("DEP-003 pending integrations prevent apply; no inventory, artifact or server was accessed.")
    if args.command == "bootstrap":
        if not (3, 12) <= sys.version_info[:2] <= (3, 14):
            raise InputError("Use control-node Python 3.12–3.14.")
        try:
            require_tools()
        except InputError:
            pass
        else:
            print("Pinned local deployment tools are already prepared.")
            return 0
        venv.EnvBuilder(with_pip=True).create(TOOLS)
        return run([str(TOOLS / "bin/python"), "-m", "pip", "install", "--only-binary=:all:", "--disable-pip-version-check",
                    "-r", str(ROOT / "deploy/requirements.txt")], timeout=300)
    require_tools()
    if args.command == "plan":
        print_framework_plan(framework_plan(bool(args.release)), args.json)
        return 0
    if args.command == "test":
        return run([sys.executable, "-B", "-m", "unittest", "discover", "-s", "deploy/tests", "-v"], timeout=180)
    playbook = str(TOOLS / "bin/ansible-playbook")
    if args.command == "validate":
        for name in ("check", "status", "apply", "validate"):
            code = run([playbook, "-i", "atoms,localhost,", "--syntax-check", f"deploy/{name}.yml"])
            if code:
                return code
        return run([playbook, "-i", "localhost,", "deploy/validate.yml"])
    inventory = inventory_path(args.inventory or str(ROOT / "server.local.yml"))
    return run([playbook, "-i", str(inventory), "--limit", "atoms", f"deploy/{args.command}.yml"])


if __name__ == "__main__":
    os.umask(0o077)
    signal.signal(signal.SIGTERM, cancel)
    try:
        sys.exit(main())
    except InputError as error:
        print(str(error), file=sys.stderr)
        sys.exit(2)
    except OSError:
        print("Local deployment tool could not run; check Python, tools and file permissions.", file=sys.stderr)
        sys.exit(2)
    except Cancelled as error:
        sys.exit(128 + error.signum)
