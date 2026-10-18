"""Small control-node adapter; Ansible owns SSH and remote inspection."""

import argparse
from contextlib import contextmanager
import importlib.metadata
import ipaddress
import json
import os
from pathlib import Path
import re
import signal
import shutil
import stat
import subprocess
import sys
import tempfile
import time
import venv


ROOT = Path(__file__).resolve().parent.parent
TOOLS = ROOT / ".tools/deploy"
sys.path.insert(0, str(ROOT / "deploy"))
from policy import InputError, DeploymentIdentity, decide_update
HELP = """Usage: ./deploy.sh <command> [options]

  bootstrap  Install pinned local Ansible tools (Python 3.12–3.14).
  validate   Offline playbook syntax and template rendering; no private config.
  test       Local behavior tests; no real inventory or server connections.
  plan       Offline implementation/artifact readiness; target checks remain live.
  check      Read-only server prerequisites; missing items return nonzero.
  status     Inspect owned release, recovery journal and actual health.
  apply      Verify/reuse a package, or build on Ubuntu, then apply transactionally.

check/status default to server.local.yml (owner-only mode 0600).
apply defaults to a matching target package or an isolated target-platform build.
--release <directory> supplies an existing Linux artifact; --release-id <UUID>
selects a retained target package (including a compatible rollback).
apply imports nonempty model settings from ignored owner-only backend/.env.
--env-file <0600.yml> selects an explicit model patch instead ({} preserves remote settings).
Password authentication uses Ansible's sshpass FD transport (sshpass >=1.06).
plan/apply/status support --json. Only explicit apply changes managed state.
See docs/engineering/deployment.md for setup and scope.
"""


def framework_plan(release_provided=False):
    """Read native Ansible declarations, without inventory or artifact access."""
    import yaml

    folder = ROOT / "deploy"
    try:
        dependencies = yaml.safe_load((folder / "integrations.yml").read_text())["atoms_integrations"]
        if not isinstance(dependencies, dict) or not dependencies:
            raise ValueError
        pending = []
        for key, value in dependencies.items():
            if (not re.fullmatch(r"[a-z_]+", key) or not isinstance(value, dict)
                    or set(value) != {"owner", "contract", "status"}
                    or not re.fullmatch(r"[A-Z]{3}-[0-9]{3}", value["owner"])
                    or value["status"] not in ("implemented", "pending")
                    or not isinstance(value["contract"], str) or not value["contract"].strip()):
                raise ValueError
            if value["status"] == "pending":
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
        producer = all((ROOT / name).is_file() for name in ["scripts/release.mjs", "scripts/release/artifact.mjs", "scripts/verification/primitives.mjs"])
        if not producer:
            pending.append({"id": "release_producer", "owner": "GEN-009", "contract": "The real producer and validator must be present."})
        return {"schemaVersion": 2, "mode": "deployment", "canApply": not pending,
                "implementationReady": not pending, "targetVerified": False,
                "deploymentVerified": False, "releaseProvided": release_provided,
                "phases": phases, "pendingIntegrations": pending}
    except (OSError, ValueError, TypeError, KeyError, IndexError, yaml.YAMLError):
        raise InputError("Deployment framework declarations are invalid or incomplete; contents suppressed.") from None


def print_framework_plan(plan, as_json):
    if as_json:
        print(json.dumps(plan, ensure_ascii=False, indent=2))
        return
    print("Deployment plan: implementationReady=" + str(plan["implementationReady"]).lower() + ", targetVerified=false")
    for section, phases in plan["phases"].items():
        print(section + ":")
        for phase in phases:
            print("  " + phase["name"] + " (" + phase["task_file"] + ")")
    print("Pending integrations: " + ("none" if not plan["pendingIntegrations"] else ""))
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
               "SSHPASS", "SSH_ASKPASS", "SSH_ASKPASS_REQUIRE", "NODE_OPTIONS", "NODE_PATH")}
    env.update(ANSIBLE_CONFIG=str(ROOT / "deploy/ansible.cfg"),
               ANSIBLE_NOCOLOR="1", ANSIBLE_DEBUG="0", ANSIBLE_VERBOSITY="0",
               ANSIBLE_LOCAL_TEMP=str(ROOT / ".runtime/deploy/tmp"),
               PYTHONDONTWRITEBYTECODE="1")
    return env


@contextmanager
def command_environment(command):
    env = clean_environment()
    if Path(command[0]).name != "ansible-playbook":
        yield env
        return
    # Unix control sockets have a short pathname limit. Keep this invocation's
    # 0700 directory short even when a release/source workspace is deeply nested.
    with tempfile.TemporaryDirectory(prefix="atoms-ssh-", dir="/tmp") as folder:
        env["ANSIBLE_SSH_CONTROL_PATH_DIR"] = folder
        try:
            yield env
        finally:
            # Only sockets in this invocation's owner-only, random directory
            # are ours. Never use the user's global SSH control directory.
            for socket in Path(folder).iterdir():
                if not stat.S_ISSOCK(socket.lstat().st_mode):
                    continue
                result = subprocess.run(["/usr/bin/ssh", "-F", "/dev/null", "-S", str(socket),
                                         "-O", "exit", "localhost"], capture_output=True, timeout=3)
                if result.returncode not in (0, 255):
                    raise InputError("Owned SSH connection cleanup failed; inspect private deployment evidence.")
            deadline = time.monotonic() + 2
            while any(Path(folder).iterdir()) and time.monotonic() < deadline:
                time.sleep(0.05)


def run(command, timeout=90, log_path=None):
    with command_environment(command) as env:
        return run_process(command, timeout, log_path, env)


def run_process(command, timeout, log_path, env):
    """Bounded process group; cancellation never leaves an SSH child running."""
    log = open(log_path, "xb") if log_path else None
    if log:
        os.chmod(log_path, 0o600)
    process = subprocess.Popen(command, cwd=ROOT, env=env,
                               stdout=log, stderr=subprocess.STDOUT if log else None, start_new_session=True)
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
    finally:
        if log:
            log.close()


def require_tools():
    try:
        pins = [line.split("==") for line in (ROOT / "deploy/requirements.txt").read_text().splitlines()
                if line and not line.startswith("#")]
        valid = all(importlib.metadata.version(name) == version for name, version in pins)
    except importlib.metadata.PackageNotFoundError:
        valid = False
    if not valid or Path(sys.prefix).resolve() != TOOLS.resolve():
        raise InputError("Run ./deploy.sh bootstrap to prepare pinned local tools.")


def require_sshpass():
    binary = shutil.which("sshpass")
    if not binary:
        raise InputError("Password deployment requires sshpass >=1.06. Install it with brew install sshpass or your OS package manager.")
    try:
        result = subprocess.run([binary, "-V"], capture_output=True, text=True, timeout=5,
                                env=clean_environment())
        match = re.search(r"^sshpass (\d+)\.(\d+)(?:\s|$)", result.stdout)
        if result.returncode or not match or tuple(map(int, match.groups())) < (1, 6):
            raise ValueError
    except (OSError, ValueError, subprocess.SubprocessError):
        raise InputError("A working sshpass >=1.06 is required for password deployment; version output suppressed.") from None


def require_password_transport(inventory):
    import yaml
    try:
        host = yaml.safe_load(inventory.read_text())["all"]["hosts"]["atoms"]
        if not isinstance(host, dict):
            raise ValueError
    except (OSError, ValueError, TypeError, KeyError, yaml.YAMLError):
        raise InputError("Validated private inventory changed or could not be read; connection refused.") from None
    if "ansible_password" in host:
        require_sshpass()


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
        allowed.add("atoms_nginx_site_path")
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
    parser.add_argument("--release-id")
    parser.add_argument("--env-file")
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
    if (args.release or args.release_id) and args.command not in ("plan", "apply"):
        raise InputError("Release selection is only accepted by plan/apply.")
    if args.release and args.release_id or args.env_file and args.command != "apply":
        raise InputError("Choose one release selection; --env-file is only accepted by apply.")
    if args.json and args.command not in ("plan", "apply", "status"):
        raise InputError("--json is only accepted by plan/apply/status.")
    if args.release_id:
        try:
            if str(__import__('uuid').UUID(args.release_id)) != args.release_id:
                raise ValueError
        except (ValueError, AttributeError):
            raise InputError("--release-id must be a canonical UUID.") from None
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
        from controller import explicit_release, node_binary
        node_binary(ROOT)
        plan = framework_plan(bool(args.release or args.release_id))
        if args.release:
            _, identity = explicit_release(ROOT, args.release)
            plan["artifact"] = {key: identity[key] for key in ("releaseId", "releaseDigest", "platform", "arch", "modulesABI")}
        print_framework_plan(plan, args.json)
        return 0
    if args.command == "test":
        require_sshpass()
        return run([sys.executable, "-B", "-m", "unittest", "discover", "-s", "deploy/tests", "-v"], timeout=600)
    playbook = str(TOOLS / "bin/ansible-playbook")
    if args.command == "validate":
        for name in ("check", "status", "deployed-status", "apply", "validate"):
            code = run([playbook, "-i", "atoms,localhost,", "--syntax-check", f"deploy/{name}.yml"])
            if code:
                return code
        return run([playbook, "-i", "localhost,", "deploy/validate.yml"])
    inventory = inventory_path(args.inventory or str(ROOT / "server.local.yml"))
    require_password_transport(inventory)
    if args.command in ("apply", "status"):
        from controller import execute
        return execute(ROOT, args, inventory, run, args.command)
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
    except subprocess.SubprocessError:
        print("Local deployment preparation failed or timed out; no target success is recorded.", file=sys.stderr)
        sys.exit(2)
    except Cancelled as error:
        sys.exit(128 + error.signum)
