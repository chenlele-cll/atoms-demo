"""Control-node artifact preparation and agentless Ansible dispatch."""
import fcntl
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import re
from uuid import UUID, uuid4

from policy import InputError
from runtime import MODEL_KEYS


def private_directory(root, parts):
    target = Path(root).resolve()
    for part in parts:
        target = target / part
        if target.is_symlink():
            raise InputError("Unsafe local deployment directory.")
        target.mkdir(mode=0o700, exist_ok=True)
        if not target.is_dir():
            raise InputError("Unsafe local deployment directory.")
    return target


def node_binary(root):
    node = shutil.which("node")
    if not node:
        raise InputError("Node is required; use the version in .nvmrc.")
    actual = subprocess.run([node, "--version"], capture_output=True, text=True, timeout=5)
    expected = "v" + (Path(root) / ".nvmrc").read_text().strip()
    if actual.returncode or actual.stdout.strip() != expected:
        raise InputError("Use the exact Node version in .nvmrc for deployment tooling.")
    return node


def artifact(root, action, directory, extra=None):
    args = [node_binary(root), str(Path(root) / "deploy/artifact.mjs"), action, str(directory)]
    if extra is not None:
        args.append(str(extra))
    result = subprocess.run(args, capture_output=True, text=True, timeout=120)
    try:
        value = json.loads(result.stdout)
        if result.returncode or value.get("ok") is not True:
            raise ValueError
        return value
    except (ValueError, AttributeError):
        raise InputError("Release validation or source snapshot failed; check the package, platform and frozen inputs.") from None


def explicit_release(root, value):
    path = Path(value).expanduser().absolute()
    if not path.is_dir() or path.is_symlink():
        raise InputError("--release must name a complete regular release directory.")
    identity = artifact(root, "metadata", path)
    if identity["platform"] != "linux":
        raise InputError("Ubuntu requires a Linux-built release; use automatic target build instead of uploading macOS dependencies.")
    return path, identity


def file_digest(filename):
    hasher = hashlib.sha256()
    with Path(filename).open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            hasher.update(chunk)
    return hasher.hexdigest()


def archive(folder, destination):
    result = subprocess.run(["tar", "-czf", str(destination), "-C", str(folder), "."],
                            capture_output=True, timeout=120)
    if result.returncode:
        raise InputError("Deployment archive preparation failed; no target was changed.")
    os.chmod(destination, 0o600)
    return file_digest(destination)


def environment_patch(filename, root=None):
    if filename is None:
        return {}
    import yaml
    path = Path(filename).expanduser().absolute()
    try:
        info = path.lstat()
        if path.is_symlink() or not path.is_file() or info.st_uid != os.getuid() or info.st_mode & 0o777 != 0o600 or info.st_size > 65536:
            raise ValueError
        if root and path.resolve().is_relative_to(Path(root).resolve()):
            ignored = subprocess.run(["git", "check-ignore", "--quiet", "--", str(path)], cwd=root, capture_output=True, timeout=5)
            if ignored.returncode:
                raise ValueError
        class UniqueKeys(yaml.SafeLoader):
            pass
        def mapping(loader, node):
            pairs = loader.construct_pairs(node, deep=True)
            result = dict(pairs)
            if len(result) != len(pairs):
                raise ValueError
            return result
        UniqueKeys.add_constructor(yaml.resolver.BaseResolver.DEFAULT_MAPPING_TAG, mapping)
        value = yaml.load(path.read_text(), Loader=UniqueKeys)
        if (not isinstance(value, dict) or not set(value) <= MODEL_KEYS
                or any(not isinstance(item, str) or any(ord(char) < 32 for char in item) for item in value.values())):
            raise ValueError
        return value
    except (OSError, ValueError, TypeError, UnicodeError, yaml.YAMLError):
        raise InputError("Private environment patch is invalid; use a 0600 YAML mapping of documented model settings.") from None


def prepare(root, options, action="apply"):
    root = Path(root).resolve()
    run_id = str(uuid4())
    work = private_directory(root, [".runtime", "deploy", "runs", run_id])
    kit = work / "kit"
    files = ["deploy/artifact.mjs", "scripts/release/artifact.mjs", "scripts/verification/primitives.mjs",
             "deploy/policy.py", "deploy/storage.py", "deploy/system.py", "deploy/runtime.py", "deploy/remote.py"]
    for name in files:
        destination = kit / name
        destination.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        shutil.copyfile(root / name, destination)
        destination.chmod(0o600)
    patch = environment_patch(getattr(options, "env_file", None), root)
    env = work / "environment.json"
    env.write_text(json.dumps(patch))
    env.chmod(0o600)
    request = {"run_id": run_id, "kit": str(kit), "environment_file": str(env),
               "result_file": str(work / "result.json"), "operation": action,
               "node_version": "v" + (root / ".nvmrc").read_text().strip(),
               "pnpm_version": json.loads((root / "package.json").read_text())["packageManager"],
               "mode": "source", "source_digest": None, "release_id": None, "release_digest": None}
    if action == "apply":
        if options.release:
            folder, identity = explicit_release(root, options.release)
            request.update(mode="artifact", release_id=identity["releaseId"], release_digest=identity["releaseDigest"])
        elif getattr(options, "release_id", None):
            request.update(mode="retained", release_id=options.release_id)
            folder = None
        else:
            folder = work / "source"
            identity = artifact(root, "snapshot", root, folder)
            request["source_digest"] = identity["sourceDigest"]
        if folder is not None:
            bundle = work / "input.tar.gz"
            request.update(archive=str(bundle), archive_digest=archive(folder, bundle))
    request_file = work / "request.json"
    request_file.write_text(json.dumps({"atoms_request": request}))
    request_file.chmod(0o600)
    return work, request_file


def public_result(value):
    if not isinstance(value, dict) or type(value.get("ok")) is not bool:
        raise ValueError
    result = {"ok": value["ok"]}
    enums = {"status": {"passed", "failed", "healthy", "unhealthy", "needs-recovery", "not-installed"},
             "mode": {"install", "activate", "configure", "repair", "noop"},
             "recovery": {"restored", "stopped", "unchanged", "schema-incompatible", "failed"}}
    for key, choices in enums.items():
        if key in value:
            if value[key] not in choices:
                raise ValueError
            result[key] = value[key]
    for key in ("changed", "deploymentVerified", "found", "healthy"):
        if key in value:
            if type(value[key]) is not bool:
                raise ValueError
            result[key] = value[key]
    if value.get("releaseId") is not None:
        if str(UUID(value["releaseId"])) != value["releaseId"]:
            raise ValueError
        result["releaseId"] = value["releaseId"]
    if value.get("releaseDigest") is not None:
        if not re.fullmatch(r"[a-f0-9]{64}", value["releaseDigest"]):
            raise ValueError
        result["releaseDigest"] = value["releaseDigest"]
    if "code" in value:
        # Codes are implementation literals, never arbitrary target messages.
        codes = set()
        for name in ("system.py", "runtime.py", "storage.py", "remote.py"):
            codes.update(re.findall(r'"([A-Z][A-Z_]+)"', Path(__file__).with_name(name).read_text()))
        if value["code"] not in codes:
            raise ValueError
        result["code"] = value["code"]
    return result


def execute(root, options, inventory, runner, action="apply"):
    root = Path(root).resolve()
    base = private_directory(root, [".runtime", "deploy"])
    lock_path = base / "control.lock"
    if lock_path.is_symlink():
        raise InputError("Unsafe local deployment lock.")
    fd = os.open(lock_path, os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
    try:
        try:
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise InputError("Another deployment command owns this workspace.") from None
        work, request_file = prepare(root, options, action)
        command = [str(root / ".tools/deploy/bin/ansible-playbook"), "-i", str(inventory), "--limit", "atoms",
                   "--extra-vars", "@" + str(request_file), str(root / ("deploy/apply.yml" if action == "apply" else "deploy/deployed-status.yml"))]
        code = runner(command, timeout=2100, log_path=work / "ansible.log")
        result_file = work / "result.json"
        try:
            if result_file.stat().st_size > 8192:
                raise ValueError
            result = public_result(json.loads(result_file.read_text()))
        except (OSError, ValueError, TypeError, AttributeError):
            result = {"ok": False, "status": "failed", "code": "TARGET_CONNECTION_OR_PREFLIGHT_FAILED", "deploymentVerified": False}
        if code:
            result.update(ok=False, status="failed", deploymentVerified=False)
            result.setdefault("code", "TARGET_PIPELINE_FAILED")
        result.update(runId=work.name, evidence=str(work.relative_to(root)))
        if options.json:
            print(json.dumps(result, ensure_ascii=False))
        else:
            print("Deployment " + result.get("status", "failed") + ": " + result.get("mode", result.get("code", "unknown")))
            print("Evidence: " + str(work.relative_to(root)))
        return 0 if not code and result.get("ok") else code or 2
    finally:
        os.close(fd)
