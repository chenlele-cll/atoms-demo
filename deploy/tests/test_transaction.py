"""Real producer/manifest/SQLite/file operations with a controlled OS adapter.

The fixture OS is never reachable through the production CLI. A separate local
process integration exercises the actual built Node application and Nginx.
"""
import fcntl
import json
import os
from pathlib import Path
import shutil
import signal
import sqlite3
import subprocess
import sys
import tempfile
import unittest
from uuid import uuid4

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "deploy"))
from runtime import Transaction
from storage import DeploymentFault, parse_environment


def node(*args):
    result = subprocess.run(["node", *map(str, args)], capture_output=True, text=True, timeout=30)
    if result.returncode:
        raise AssertionError(result.stdout + result.stderr)
    return result.stdout


def package(stage, schema=1, content="fixture A"):
    folder = stage / ("package-" + str(uuid4()))
    files = {"backend/package.json": json.dumps({"name": "@atoms/backend", "type": "module"}),
             "backend/dist/server.js": "// fixture only", "backend/dist/app.js": content,
             "backend/dist/storage/migrations.js": "export const migrations=" + json.dumps([{"version": n} for n in range(1, schema + 1)]) + ";",
             "backend/node_modules/.pnpm/contracts/dist/index.js": "export const snapshotSchema={};",
             "frontend/index.html": content, "deploy/nginx.conf.template": "// fixture only"}
    bundle = json.dumps({"id": "company-landing", "version": 1, "digest": "1" * 64, "files": {"/LICENSE": "MIT"}})
    files.update({"backend/dist/template-assets/company-landing.bundle.json": bundle,
                  "frontend/template-assets/company-landing.bundle.json": bundle})
    for name, value in files.items():
        path = folder / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(value)
    (folder / "backend/node_modules/@atoms").mkdir()
    (folder / "backend/node_modules/@atoms/contracts").symlink_to("../.pnpm/contracts")
    # Production builds normalize public input modes. Match those modes even
    # when deploy.sh deliberately starts the test runner under umask 0077.
    for path in folder.rglob("*"):
        if not path.is_symlink():
            path.chmod(0o755 if path.is_dir() else 0o644)
    identity = {"releaseId": str(uuid4()), "sourceDigest": "2" * 64, "lockDigest": "3" * 64,
                "buildDigest": "4" * 64, "pnpm": "pnpm@12.11.2"}
    code = "import{sealRelease}from " + json.dumps((ROOT / "scripts/release/artifact.mjs").as_uri()) + ";await sealRelease(process.argv[1],JSON.parse(process.argv[2]));"
    node("--input-type=module", "-e", code, folder, json.dumps(identity))
    return folder


class FixtureSystem:
    def __init__(self, context):
        self.c = context
        self.running = None
        self.starts = self.stops = self.reloads = 0
        self.loaded_proxy = None
        self.fail_health = set()

    def preflight(self):
        pass

    def machine(self):
        return "isolated-fixture-machine"

    def check_ports(self, _owned):
        pass

    def ensure_user(self):
        return os.geteuid(), os.getegid()

    def bridge(self, action, release, extra=None):
        if action == "probe":
            # The native binding is tested against real built packages separately.
            return {"ok": True}
        result = subprocess.run(["node", str(ROOT / "deploy/artifact.mjs"), action, str(release)], capture_output=True, text=True, timeout=30)
        value = json.loads(result.stdout)
        if result.returncode:
            raise DeploymentFault("RELEASE_INVALID")
        return value

    def active(self, _name):
        return self.running is not None

    def stop(self):
        self.running = None
        self.stops += 1

    def start(self):
        self.running = (Path(self.c["root"]) / "current").resolve()
        self.starts += 1
        db = sqlite3.connect(Path(self.c["root"]) / "shared/data/atoms.sqlite")
        try:
            db.execute("CREATE TABLE IF NOT EXISTS saved_fixture(value TEXT)")
            db.execute("INSERT INTO saved_fixture SELECT 'preserved' WHERE NOT EXISTS(SELECT 1 FROM saved_fixture)")
            db.execute("PRAGMA user_version=" + str(self.bridge("schema", self.running)["schemaMax"]))
            db.commit()
        finally:
            db.close()

    def nginx_test(self):
        if b"invalid-fixture" in Path(self.c["site_path"]).read_bytes():
            raise DeploymentFault("NGINX_CONFIGURATION")

    def reload_proxy(self):
        self.reloads += 1
        self.loaded_proxy = Path(self.c["site_path"]).read_bytes()

    def database_schema(self, path):
        if not Path(path).exists():
            return 0
        db = sqlite3.connect(path)
        try:
            return db.execute("PRAGMA user_version").fetchone()[0]
        finally:
            db.close()

    def health(self, release, public=True):
        return self.running == Path(release).resolve() and self.running.name not in self.fail_health and (not public or self.proxy_health(release))

    def proxy_health(self, _release):
        return self.loaded_proxy == Path(self.c["site_path"]).read_bytes() if Path(self.c["site_path"]).exists() else False

    def wait_health(self, release):
        if not self.health(release, False) or not self.health(release, True):
            raise DeploymentFault("HEALTH_FAILED")


class TransactionTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="atoms-transaction-")
        self.base = Path(self.temp.name).resolve()
        self.stage = self.base / "stage"
        self.stage.mkdir()
        root = self.base / "owned"
        self.c = {"root": str(root), "stage": str(self.stage), "run_id": str(uuid4()),
                  "node": shutil.which("node"), "node_version": node("--version").strip(), "pnpm_version": "pnpm@12.11.2",
                  "bridge": str(ROOT / "deploy/artifact.mjs"), "ip": "127.0.0.1", "backend_port": 31001, "https_port": 34443,
                  "site_path": str(self.base / "atoms.conf"), "unit_path": str(self.base / "atoms.service"),
                  "certificate": str(self.base / "fixture.crt"), "key": str(self.base / "fixture.key"), "environment": {}}
        for key in ["certificate", "key"]:
            Path(self.c[key]).write_text("controlled fixture material")
        config = self.stage / "configuration"
        config.mkdir()
        header = "# Managed by atoms deploy.sh; root=" + str(root) + "\n"
        (config / "atoms-backend.service").write_text(header + "[Service]\n")
        (config / "nginx-site.conf").write_text(header + "# isolated proxy\n")
        self.system = FixtureSystem(self.c)
        self.tx = Transaction(self.c, self.system)
        self.a = package(self.stage)

    def tearDown(self):
        self.temp.cleanup()

    def apply(self, source=None):
        self.c["run_id"] = str(uuid4())
        return self.tx.apply(source or self.a)

    def rows(self):
        db = sqlite3.connect(self.tx.database)
        try:
            return db.execute("SELECT value FROM saved_fixture").fetchall()
        finally:
            db.close()

    def test_first_install_and_healthy_repeat_preserve_identity_processes_and_data(self):
        installed = self.apply()
        before = self.tx.state.read_bytes()
        counts = (self.system.starts, self.system.reloads)
        second = self.apply()
        self.assertEqual(installed["releaseId"], second["releaseId"])
        self.assertEqual(second["mode"], "noop")
        self.assertFalse(second["changed"])
        self.assertEqual(counts, (self.system.starts, self.system.reloads))
        self.assertEqual(self.tx.state.read_bytes(), before)
        self.assertEqual(self.rows(), [("preserved",)])

    def test_verified_cache_can_resolve_source_or_retained_id_without_service_changes(self):
        installed = self.apply()
        counts = (self.system.starts, self.system.stops, self.system.reloads)
        self.c["release_id"] = installed["releaseId"]
        cached = self.tx.resolve()
        self.assertTrue(cached["found"])
        self.assertEqual(Path(cached["directory"]), self.tx.current_release())
        self.c["release_id"] = None
        self.c["source_digest"] = cached["sourceDigest"]
        self.assertEqual(self.tx.resolve()["releaseId"], installed["releaseId"])
        self.assertEqual(counts, (self.system.starts, self.system.stops, self.system.reloads))
        self.c["source_digest"] = "f" * 64
        self.assertFalse(self.tx.resolve()["found"])

    def test_interruption_after_health_heals_success_metadata_without_restart(self):
        self.apply()
        saved = json.loads(self.tx.state.read_text())
        saved["backendDigest"] = "f" * 64
        self.tx.state.write_text(json.dumps(saved))
        counts = (self.system.starts, self.system.reloads)
        self.assertEqual(self.apply()["mode"], "noop")
        self.assertNotEqual(json.loads(self.tx.state.read_text())["backendDigest"], "f" * 64)
        self.assertEqual(counts, (self.system.starts, self.system.reloads))

    def test_private_configuration_merge_changes_only_backend_and_preserves_literal_values(self):
        self.apply()
        original = self.tx.current_release().name
        counts = (self.system.starts, self.system.reloads)
        secret = 'fixture$"\\{{literal-not-template}}'
        self.c["environment"] = {"OPENAI_API_KEY": secret}
        result = self.apply()
        self.assertEqual(result["releaseId"], original)
        self.assertEqual(result["mode"], "configure")
        self.assertEqual((self.system.starts, self.system.reloads), (counts[0] + 1, counts[1]))
        self.assertEqual(parse_environment(self.tx.environment.read_bytes())["OPENAI_API_KEY"], secret)
        self.c["environment"] = {"MODEL_ID": "fixture-model"}
        self.apply()
        self.assertEqual(parse_environment(self.tx.environment.read_bytes())["OPENAI_API_KEY"], secret)
        self.assertNotIn(secret, self.tx.state.read_text() + self.tx.journal.read_text())
        self.assertEqual(self.tx.environment.stat().st_mode & 0o777, 0o600)
        self.assertEqual(self.rows(), [("preserved",)])

    def test_proxy_only_change_does_not_restart_backend_and_repeats_noop(self):
        self.apply()
        starts, reloads = self.system.starts, self.system.reloads
        with (self.stage / "configuration/nginx-site.conf").open("a") as output:
            output.write("# actual proxy input change\n")
        result = self.apply()
        self.assertEqual(result["mode"], "configure")
        self.assertEqual(self.system.starts, starts)
        self.assertEqual(self.system.reloads, reloads + 1)
        self.assertEqual(self.apply()["mode"], "noop")

    def test_code_update_retains_package_and_cold_backup(self):
        first = self.apply()
        b = package(self.stage, content="fixture B")
        second = self.apply(b)
        self.assertNotEqual(first["releaseId"], second["releaseId"])
        self.assertTrue((self.tx.root / "releases" / first["releaseId"]).is_dir())
        backup = self.tx.root / "backups" / self.c["run_id"] / "atoms.sqlite"
        db = sqlite3.connect(backup)
        try:
            self.assertEqual(db.execute("PRAGMA quick_check").fetchone(), ("ok",))
            self.assertEqual(db.execute("SELECT value FROM saved_fixture").fetchall(), self.rows())
        finally:
            db.close()

    def test_invalid_proxy_is_rejected_before_stopping_the_old_backend(self):
        self.apply()
        before, starts, stops = self.tx.state.read_bytes(), self.system.starts, self.system.stops
        (self.stage / "configuration/nginx-site.conf").write_text(self.tx.header + "invalid-fixture")
        with self.assertRaises(DeploymentFault):
            self.apply()
        self.assertEqual(self.tx.state.read_bytes(), before)
        self.assertEqual((self.system.starts, self.system.stops), (starts, stops))
        self.assertEqual(json.loads(self.tx.journal.read_text())["recovery"], "unchanged")

    def test_failed_new_release_restores_compatible_old_code_without_restoring_database(self):
        first = self.apply()
        before = self.tx.state.read_bytes()
        b = package(self.stage, content="fails health")
        self.system.fail_health.add(json.loads((b / "release.json").read_text())["releaseId"])
        with self.assertRaises(DeploymentFault):
            self.apply(b)
        self.assertEqual(self.tx.current_release().name, first["releaseId"])
        self.assertEqual(self.tx.state.read_bytes(), before)
        self.assertTrue(self.system.health(self.tx.current_release()))
        self.assertEqual(json.loads(self.tx.journal.read_text())["recovery"], "restored")
        self.assertEqual(self.rows(), [("preserved",)])

    def test_incompatible_rollback_preserves_new_schema_and_supports_forward_repair(self):
        self.apply()
        before = self.tx.state.read_bytes()
        b = package(self.stage, schema=2, content="migration fixture")
        identity = json.loads((b / "release.json").read_text())["releaseId"]
        self.system.fail_health.add(identity)
        with self.assertRaises(DeploymentFault):
            self.apply(b)
        self.assertIsNone(self.system.running)
        self.assertEqual(self.system.database_schema(self.tx.database), 2)
        self.assertEqual(self.tx.state.read_bytes(), before)
        self.assertEqual(json.loads(self.tx.journal.read_text())["recovery"], "schema-incompatible")
        self.system.fail_health.clear()
        repaired = self.apply(b)
        self.assertEqual(repaired["releaseId"], identity)
        self.assertEqual(self.rows(), [("preserved",)])

    def test_corrupt_package_or_unowned_resources_are_not_overwritten(self):
        self.apply()
        before = self.tx.state.read_bytes()
        b = package(self.stage)
        (b / "frontend/index.html").write_text("tampered")
        with self.assertRaises(DeploymentFault):
            self.apply(b)
        self.assertEqual(self.tx.state.read_bytes(), before)
        Path(self.c["unit_path"]).write_text("unrelated service")
        with self.assertRaises(DeploymentFault):
            self.apply()
        self.assertEqual(Path(self.c["unit_path"]).read_text(), "unrelated service")

    def test_target_lock_rejects_a_second_owner_and_releases_without_stale_directory(self):
        self.apply()
        lock = os.open(self.tx.root / ".deployment.lock", os.O_RDWR)
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            with self.assertRaises(DeploymentFault) as caught:
                self.apply()
            self.assertEqual(caught.exception.code, "DEPLOYMENT_BUSY")
        finally:
            os.close(lock)
        self.assertEqual(self.apply()["mode"], "noop")

    def test_sigterm_during_activation_recovers_compatible_code_and_keeps_success(self):
        from remote import cancelled
        first = self.apply()
        state = self.tx.state.read_bytes()
        b = package(self.stage, content="signal fixture")
        child = os.fork()
        if child == 0:
            signal.signal(signal.SIGTERM, cancelled)
            original = self.system.start
            def interrupted_start():
                self.system.start = original
                original()
                os.kill(os.getpid(), signal.SIGTERM)
            self.system.start = interrupted_start
            try:
                self.apply(b)
            except DeploymentFault as error:
                os._exit(0 if error.code == "DEPLOYMENT_INTERRUPTED" else 3)
            os._exit(4)
        _, status = os.waitpid(child, 0)
        self.assertEqual(os.waitstatus_to_exitcode(status), 0)
        self.assertEqual(self.tx.current_release().name, first["releaseId"])
        self.assertEqual(self.tx.state.read_bytes(), state)
        self.assertEqual(json.loads(self.tx.journal.read_text())["recovery"], "restored")
        self.assertEqual(self.rows(), [("preserved",)])
        self.assertEqual(self.apply()["mode"], "noop")

    def test_process_death_releases_target_lock_without_removing_lock_file(self):
        self.apply()
        reader, writer = os.pipe()
        child = os.fork()
        if child == 0:
            os.close(reader)
            fd = os.open(self.tx.root / ".deployment.lock", os.O_RDWR)
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
            os.write(writer, b"locked")
            signal.pause()
            os._exit(5)
        os.close(writer)
        try:
            self.assertEqual(os.read(reader, 6), b"locked")
            with self.assertRaisesRegex(DeploymentFault, "DEPLOYMENT_BUSY"):
                self.apply()
        finally:
            os.close(reader)
            os.kill(child, signal.SIGKILL)
            os.waitpid(child, 0)
        self.assertTrue((self.tx.root / ".deployment.lock").is_file())
        self.assertEqual(self.apply()["mode"], "noop")


if __name__ == "__main__":
    unittest.main()
