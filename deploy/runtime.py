"""One target transaction under an OS lock; Ansible owns transport/staging.

Only verified immutable packages and explicitly owned files enter this module.
The system adapter is injectable for isolated tests, never selectable by CLI.
"""
import fcntl
import json
import os
from pathlib import Path
import re
import shutil
import sqlite3

from policy import DeploymentIdentity, InputError, decide_update
from storage import (DeploymentFault, atomic_write, digest, directory, environment_bytes,
                     parse_environment, read_json, regular, write_json)


MODEL_KEYS = {"OPENAI_API_KEY", "OPENAI_BASE_URL", "MODEL_ID", "MODEL_TIMEOUT_MS", "MODEL_MAX_OUTPUT_TOKENS"}


class Transaction:
    def __init__(self, context, system):
        self.c = context
        self.ops = system
        self.root = Path(context["root"])
        self.stage = Path(context["stage"])
        self.marker = self.root / ".atoms-deployment.json"
        self.state = self.root / "shared/config/deployment.json"
        self.journal = self.root / "shared/config/operation.json"
        self.environment = self.root / "shared/config/backend.env"
        self.database = self.root / "shared/data/atoms.sqlite"
        self.header = "# Managed by atoms deploy.sh; root=" + str(self.root) + "\n"

    def root_owned(self):
        if self.root.is_symlink():
            raise DeploymentFault("UNSAFE_PATH")
        if not self.root.exists():
            return False
        if not self.root.is_dir() or self.root.stat().st_uid != os.geteuid():
            raise DeploymentFault("UNOWNED_ROOT")
        if not self.marker.exists():
            if list(self.root.iterdir()):
                raise DeploymentFault("UNOWNED_ROOT")
            return False
        marker = read_json(self.marker)
        if marker != {"schemaVersion": 1, "root": str(self.root), "machine": self.ops.machine()}:
            raise DeploymentFault("UNOWNED_ROOT")
        return True

    def managed_file(self, filename):
        path = Path(filename)
        if regular(path, required=False):
            if not path.read_bytes().startswith(self.header.encode()):
                raise DeploymentFault("UNOWNED_CONFIGURATION")
            return True
        return False

    def preflight(self):
        self.ops.preflight()
        self.root_owned()
        self.managed_file(self.c["unit_path"])
        proxy = self.managed_file(self.c["site_path"])
        self.ops.check_ports(proxy)

    def verify(self, release):
        release = Path(release)
        resolved = release.resolve()
        if release.is_symlink() or not (resolved.is_relative_to(self.stage.resolve()) or
                                       resolved.is_relative_to((self.root / "releases").resolve())):
            raise DeploymentFault("UNSAFE_RELEASE_PATH")
        value = self.ops.bridge("verify", release)
        if value["node"] != self.c["node_version"] or value["pnpm"] != self.c["pnpm_version"]:
            raise DeploymentFault("RELEASE_PLATFORM")
        return value

    def resolve(self):
        """Read-only lookup; no database, lock or service changes."""
        self.preflight()
        if not self.root_owned():
            return {"ok": True, "found": False}
        candidates = []
        current = self.current_release()
        if current:
            candidates.append(current)
        folder = self.root / "releases"
        if folder.exists():
            if folder.is_symlink():
                raise DeploymentFault("UNSAFE_PATH")
            candidates += [item for item in sorted(folder.iterdir()) if item != current and re.fullmatch(r"[a-f0-9-]{36}", item.name)]
        for candidate in candidates:
            manifest = candidate / "release.json"
            if not regular(manifest, required=False):
                continue
            try:
                value = json.loads(manifest.read_text())
            except ValueError:
                raise DeploymentFault("RELEASE_INVALID") from None
            match = (value.get("releaseId") == self.c.get("release_id") if self.c.get("release_id")
                     else value.get("sourceDigest") == self.c.get("source_digest"))
            if match:
                verified = self.verify(candidate)
                if verified["releaseId"] != candidate.name:
                    raise DeploymentFault("IMMUTABLE_RELEASE_CONFLICT")
                if self.c.get("release_digest") and verified["releaseDigest"] != self.c["release_digest"]:
                    raise DeploymentFault("IMMUTABLE_RELEASE_CONFLICT")
                return {"ok": True, "found": True, "directory": str(candidate), **verified}
        return {"ok": True, "found": False}

    def current_release(self):
        path = self.root / "current"
        if not path.exists() and not path.is_symlink():
            return None
        if not path.is_symlink():
            raise DeploymentFault("UNOWNED_CURRENT")
        target = path.resolve()
        if target.parent != (self.root / "releases").resolve() or not re.fullmatch(r"[a-f0-9-]{36}", target.name):
            raise DeploymentFault("UNOWNED_CURRENT")
        if self.verify(target)["releaseId"] != target.name:
            raise DeploymentFault("IMMUTABLE_RELEASE_CONFLICT")
        return target

    def saved_state(self):
        value = read_json(self.state, optional=True)
        if value is not None:
            try:
                if value.get("schemaVersion") != 1 or type(value["schemaMax"]) is not int or value["schemaMax"] < 0:
                    raise ValueError
                DeploymentIdentity(value["releaseId"], value["releaseDigest"], value["backendDigest"], value["proxyDigest"])
            except (ValueError, TypeError, KeyError, InputError):
                raise DeploymentFault("INVALID_STATE") from None
        return value

    def owned_directory(self, relative, mode=0o700, owner=None):
        current = self.root
        for part in Path(relative).parts:
            current = current / part
            if current.is_symlink():
                raise DeploymentFault("UNSAFE_PATH")
            current.mkdir(exist_ok=True, mode=mode)
            if not current.is_dir():
                raise DeploymentFault("UNSAFE_PATH")
        os.chmod(current, mode)
        if owner is not None:
            os.chown(current, *owner)
        return current

    def layout(self):
        owner = self.ops.ensure_user()
        self.owned_directory("releases", 0o755)
        self.owned_directory("shared", 0o750, (os.geteuid(), owner[1]))
        self.owned_directory("shared/config", 0o750, (os.geteuid(), owner[1]))
        self.owned_directory("shared/data", 0o700, owner)
        self.owned_directory("backups")

    def environment_data(self):
        existing = parse_environment(self.environment.read_bytes()) if regular(self.environment, False) else {}
        if existing.get("DATABASE_PATH", str(self.database)) != str(self.database):
            raise DeploymentFault("DATABASE_PATH_MISMATCH")
        patch = self.c.get("environment", {})
        if not isinstance(patch, dict) or not set(patch) <= MODEL_KEYS:
            raise DeploymentFault("INVALID_ENVIRONMENT")
        existing.update(patch)
        origin = "https://" + self.c["ip"] + (":" + str(self.c["https_port"]) if self.c["https_port"] != 443 else "")
        existing.update(NODE_ENV="production", HOST="127.0.0.1", PORT=str(self.c["backend_port"]),
                        DATABASE_PATH=str(self.database), APP_ORIGINS=origin)
        return environment_bytes(existing)

    def config_data(self):
        folder = self.stage / "configuration"
        unit = (folder / "atoms-backend.service").read_bytes()
        proxy = (folder / "nginx-site.conf").read_bytes()
        if not unit.startswith(self.header.encode()) or not proxy.startswith(self.header.encode()):
            raise DeploymentFault("INVALID_CONFIGURATION")
        env = self.environment_data()
        for name in ("certificate", "key"):
            regular(Path(self.c[name]).resolve(strict=True))
        return {"unit": unit, "proxy": proxy, "environment": env,
                "backend_digest": digest(unit + env),
                "proxy_digest": digest(proxy + Path(self.c["certificate"]).read_bytes() + Path(self.c["key"]).read_bytes())}

    def publish(self, source, identity):
        destination = self.root / "releases" / identity["releaseId"]
        if destination.exists() or destination.is_symlink():
            if self.verify(destination)["releaseDigest"] != identity["releaseDigest"]:
                raise DeploymentFault("IMMUTABLE_RELEASE_CONFLICT")
            return destination
        temporary = destination.with_name("." + destination.name + "." + self.c["run_id"])
        if temporary.exists() or temporary.is_symlink():
            raise DeploymentFault("UNSAFE_PATH")
        try:
            shutil.copytree(source, temporary, symlinks=True)
            if self.verify(temporary)["releaseDigest"] != identity["releaseDigest"]:
                raise DeploymentFault("RELEASE_INVALID")
            # The manifest inventories descendants, not the package-root mode.
            # Keep descendant modes/content immutable; permit service traversal.
            os.chmod(temporary, 0o755)
            os.rename(temporary, destination)
        except BaseException:
            if temporary.is_dir() and not temporary.is_symlink():
                shutil.rmtree(temporary)
            raise
        return destination

    def snapshot(self, previous, baseline_healthy):
        folder = self.owned_directory("backups/" + self.c["run_id"])
        result = {"previous": str(previous) if previous else None, "baselineHealthy": baseline_healthy, "files": {}}
        for name, filename in [("unit", self.c["unit_path"]), ("proxy", self.c["site_path"]), ("environment", self.environment)]:
            path = Path(filename)
            if regular(path, False):
                atomic_write(folder / name, path.read_bytes())
                result["files"][name] = True
            else:
                result["files"][name] = False
        write_json(folder / "snapshot.json", result)
        return folder, result

    def cold_backup(self, folder):
        if not regular(self.database, False):
            return
        for suffix in ("", "-wal", "-shm"):
            filename = Path(str(self.database) + suffix)
            if regular(filename, False):
                shutil.copyfile(filename, folder / ("atoms.sqlite" + suffix))
                os.chmod(folder / ("atoms.sqlite" + suffix), 0o600)
        try:
            db = sqlite3.connect("file:" + str(folder / "atoms.sqlite") + "?mode=ro", uri=True)
            try:
                if db.execute("PRAGMA quick_check").fetchone() != ("ok",):
                    raise ValueError
            finally:
                db.close()
        except (sqlite3.Error, ValueError):
            raise DeploymentFault("BACKUP_INVALID") from None

    def switch(self, release):
        link = self.root / (".current." + self.c["run_id"])
        if link.exists() or link.is_symlink():
            raise DeploymentFault("UNSAFE_PATH")
        link.symlink_to(Path("releases") / release.name)
        os.replace(link, self.root / "current")

    def restore_files(self, backup, snapshot):
        for name, filename in [("unit", self.c["unit_path"]), ("proxy", self.c["site_path"]), ("environment", self.environment)]:
            path = Path(filename)
            if snapshot["files"][name]:
                atomic_write(path, (backup / name).read_bytes(), 0o600 if name == "environment" else 0o644)
            elif regular(path, False):
                path.unlink()

    def recover(self, backup, snapshot, proxy_reloaded, touched_backend=True, prepared_only=False):
        previous = Path(snapshot["previous"]) if snapshot["previous"] else None
        if prepared_only:
            self.restore_files(backup, snapshot)
            return "unchanged"
        if touched_backend:
            self.ops.stop()
        if previous:
            schema = self.ops.bridge("schema", previous)["schemaMax"]
            if self.ops.database_schema(self.database) > schema:
                return "schema-incompatible"
        self.restore_files(backup, snapshot)
        if previous:
            self.switch(previous)
        elif (self.root / "current").is_symlink():
            (self.root / "current").unlink()
        if snapshot["baselineHealthy"] and previous:
            if touched_backend:
                self.ops.start()
            self.ops.nginx_test()
            self.ops.reload_proxy()
            self.ops.wait_health(previous)
            return "restored"
        if proxy_reloaded:
            self.ops.reload_proxy()
        return "stopped"

    def apply(self, source):
        self.preflight()
        source = Path(source)
        identity = self.verify(source)
        if self.c.get("release_digest") and identity["releaseDigest"] != self.c["release_digest"]:
            raise DeploymentFault("RELEASE_INVALID")
        if self.c.get("source_digest") and identity["sourceDigest"] != self.c["source_digest"]:
            raise DeploymentFault("SOURCE_CHANGED")
        desired_schema = self.ops.bridge("schema", source)["schemaMax"]
        self.ops.bridge("probe", source, self.stage / "native-probe.sqlite")
        self.root_owned()
        directory(self.root, 0o755)
        lock_path = self.root / ".deployment.lock"
        regular(lock_path, False)
        fd = os.open(lock_path, os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
        try:
            try:
                fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError:
                raise DeploymentFault("DEPLOYMENT_BUSY") from None
            if not self.marker.exists():
                if set(item.name for item in self.root.iterdir()) - {".deployment.lock"}:
                    raise DeploymentFault("UNOWNED_ROOT")
                write_json(self.marker, {"schemaVersion": 1, "root": str(self.root), "machine": self.ops.machine()})
            else:
                self.root_owned()
            self.layout()
            previous = self.current_release()
            state = self.saved_state()
            journal = read_json(self.journal, optional=True)
            if state and previous and state["releaseId"] == previous.name and state["releaseDigest"] != self.verify(previous)["releaseDigest"]:
                raise DeploymentFault("STATE_DRIFT")
            if state and (not previous or state.get("releaseId") != previous.name):
                if not journal or journal.get("targetReleaseId") != (previous.name if previous else None):
                    raise DeploymentFault("STATE_DRIFT")
            if self.ops.database_schema(self.database) > desired_schema:
                raise DeploymentFault("SCHEMA_INCOMPATIBLE")
            configs = self.config_data()
            self.ops.model_configuration(source, configs["environment"])
            backend_healthy = bool(previous and self.ops.health(previous, False))
            proxy_healthy = bool(previous and self.ops.proxy_health(previous))
            baseline = backend_healthy and proxy_healthy
            desired = DeploymentIdentity(identity["releaseId"], identity["releaseDigest"], configs["backend_digest"], configs["proxy_digest"])
            current = None
            if previous:
                current_id = self.verify(previous)
                old_backend = (Path(self.c["unit_path"]).read_bytes() + self.environment.read_bytes()
                               if regular(self.c["unit_path"], False) and regular(self.environment, False) else b"")
                old_proxy = (Path(self.c["site_path"]).read_bytes() + Path(self.c["certificate"]).read_bytes() + Path(self.c["key"]).read_bytes()
                             if regular(self.c["site_path"], False) else b"")
                current = DeploymentIdentity(current_id["releaseId"], current_id["releaseDigest"], digest(old_backend), digest(old_proxy))
                # Renewal changes on-disk certs before reload; retain the last
                # successfully loaded proxy fingerprint for change detection.
                if state and state.get("releaseId") == previous.name and state.get("proxyDigest") != configs["proxy_digest"]:
                    current = DeploymentIdentity(current.release_id, current.content_digest,
                                                 current.backend_config_digest, state["proxyDigest"])
            decision = decide_update(current, desired, backend_healthy=backend_healthy, proxy_healthy=proxy_healthy)
            if decision["mode"] == "noop":
                self.ops.wait_health(previous)
                if (not state or any(state.get(key) != value for key, value in {
                        "releaseId": identity["releaseId"], "releaseDigest": identity["releaseDigest"],
                        "backendDigest": configs["backend_digest"], "proxyDigest": configs["proxy_digest"]}.items())):
                    write_json(self.state, {"schemaVersion": 1, "releaseId": identity["releaseId"], "releaseDigest": identity["releaseDigest"],
                                           "backendDigest": configs["backend_digest"], "proxyDigest": configs["proxy_digest"],
                                           "schemaMax": desired_schema, "runId": self.c["run_id"]})
                    write_json(self.journal, {"runId": self.c["run_id"], "targetReleaseId": identity["releaseId"], "phase": "complete"})
                return {"ok": True, "status": "passed", "mode": "noop", "changed": False,
                        "releaseId": identity["releaseId"], "releaseDigest": identity["releaseDigest"], "deploymentVerified": True}
            destination = self.publish(source, identity)
            backup, snapshot = self.snapshot(previous, baseline)
            operation = {"runId": self.c["run_id"], "targetReleaseId": identity["releaseId"], "phase": "prepared", "backup": str(backup)}
            write_json(self.journal, operation)
            proxy_reloaded = False
            try:
                # Test installed owned files before touching the running backend.
                atomic_write(Path(self.c["site_path"]), configs["proxy"], 0o644)
                self.ops.nginx_test()
                if decision["restart_backend"]:
                    operation["phase"] = "stopping"
                    write_json(self.journal, operation)
                    if previous:
                        self.ops.stop()
                    self.cold_backup(backup)
                atomic_write(self.environment, configs["environment"])
                atomic_write(Path(self.c["unit_path"]), configs["unit"], 0o644)
                self.switch(destination)
                operation["phase"] = "activated"
                write_json(self.journal, operation)
                if decision["restart_backend"]:
                    self.ops.start()
                if decision["reload_proxy"]:
                    self.ops.reload_proxy()
                    proxy_reloaded = True
                self.ops.wait_health(destination)
                successful = {"schemaVersion": 1, "releaseId": identity["releaseId"], "releaseDigest": identity["releaseDigest"],
                              "backendDigest": configs["backend_digest"], "proxyDigest": configs["proxy_digest"],
                              "schemaMax": desired_schema, "runId": self.c["run_id"]}
                write_json(self.state, successful)
                operation["phase"] = "complete"
                write_json(self.journal, operation)
                return {"ok": True, "status": "passed", "mode": decision["mode"], "changed": True,
                        "releaseId": identity["releaseId"], "releaseDigest": identity["releaseDigest"], "deploymentVerified": True}
            except BaseException as error:
                try:
                    recovery = self.recover(backup, snapshot, proxy_reloaded,
                                            touched_backend=decision["restart_backend"],
                                            prepared_only=operation["phase"] == "prepared")
                except BaseException:
                    recovery = "failed"
                operation.update(phase="failed", recovery=recovery)
                write_json(self.journal, operation)
                code = error.code if isinstance(error, DeploymentFault) else "DEPLOYMENT_INTERRUPTED"
                raise DeploymentFault(code) from None
        finally:
            os.close(fd)

    def status(self):
        if not self.root_owned():
            return {"ok": True, "status": "not-installed", "healthy": False, "deploymentVerified": False}
        current = self.current_release()
        if current and regular(self.environment, False):
            self.ops.model_configuration(current, self.environment.read_bytes())
        saved = self.saved_state()
        journal = read_json(self.journal, optional=True)
        healthy = bool(current and self.ops.health(current, False) and self.ops.health(current, True) and self.ops.proxy_health(current))
        aligned = bool(saved and current and saved.get("releaseId") == current.name and saved["releaseDigest"] == self.verify(current)["releaseDigest"])
        return {"ok": True, "status": "healthy" if healthy and aligned else "needs-recovery" if journal and journal.get("phase") != "complete" else "unhealthy",
                "healthy": healthy, "releaseId": current.name if current else None,
                "releaseDigest": saved.get("releaseDigest") if aligned else None,
                "deploymentVerified": healthy and aligned}
