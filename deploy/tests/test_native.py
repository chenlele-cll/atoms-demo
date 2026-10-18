"""Opt-in real package/Node/Nginx/TLS/SQLite transaction, on owned local ports.

Only the Ubuntu service manager is replaced. Production transaction, verifier,
templates, health checks and application bytes are exercised unchanged.
"""
import http.cookiejar
import json
import os
from pathlib import Path
import shutil
import signal
import socket
import sqlite3
import ssl
import subprocess
import sys
import tempfile
import unittest
import urllib.request
from uuid import uuid4

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "deploy"))
from runtime import Transaction
from storage import DeploymentFault, parse_environment
from system import NoRedirect, System


def free_port():
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


class LocalProcesses(System):
    def __init__(self, context, prefix):
        super().__init__(context)
        self.prefix = prefix
        self.backend = self.proxy = None
        self.running = None
        self.starts = self.reloads = 0
        self.fail_release = None
        self.files = []

    def preflight(self):
        # Local fixture preconditions; Ubuntu/systemd belong to target acceptance.
        if not Path(self.c["nginx"]).is_file():
            raise DeploymentFault("NGINX_REQUIRED")

    def machine(self):
        return "owned-local-process-integration"

    def check_ports(self, _owned):
        for port, process in ((self.c["backend_port"], self.backend), (self.c["https_port"], self.proxy)):
            if process is None:
                with socket.socket() as sock:
                    sock.bind(("127.0.0.1", port))

    def ensure_user(self):
        return os.geteuid(), os.getegid()

    def active(self, name):
        process = self.proxy if name == "nginx.service" else self.backend
        return process is not None and process.poll() is None

    def backend_matches(self, release):
        return self.active("atoms-backend.service") and self.running == Path(release).resolve()

    def opener(self):
        return urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect(),
            urllib.request.HTTPSHandler(context=ssl.create_default_context(cafile=self.c["certificate"])))

    def start(self):
        if self.active("atoms-backend.service"):
            raise AssertionError("Only a stopped owned backend may be started")
        self.running = (Path(self.c["root"]) / "current").resolve()
        env = {"PATH": str(Path(self.c["node"]).parent) + ":/usr/bin:/bin"}
        env.update(parse_environment((Path(self.c["root"]) / "shared/config/backend.env").read_bytes()))
        log = (self.prefix / ("backend-" + str(self.starts) + ".log")).open("wb")
        self.files.append(log)
        self.backend = subprocess.Popen([self.c["node"], "dist/server.js"], cwd=self.running / "backend",
            env=env, stdout=log, stderr=log, start_new_session=True)
        self.starts += 1

    @staticmethod
    def terminate(process):
        if process and process.poll() is None:
            os.killpg(process.pid, signal.SIGTERM)
            try:
                process.wait(timeout=10)
            except subprocess.TimeoutExpired:
                os.killpg(process.pid, signal.SIGKILL)
                process.wait(timeout=5)

    def stop(self):
        self.terminate(self.backend)
        self.backend = None

    def proxy_args(self):
        return [self.c["nginx"], "-p", str(self.prefix) + "/", "-c", str(self.prefix / "nginx.conf")]

    def nginx_test(self):
        self.checked(self.proxy_args() + ["-t"], "NGINX_CONFIGURATION")

    def reload_proxy(self):
        if self.active("nginx.service"):
            self.proxy.send_signal(signal.SIGHUP)
        else:
            log = (self.prefix / "nginx.log").open("wb")
            self.files.append(log)
            self.proxy = subprocess.Popen(self.proxy_args(), stdout=log, stderr=log, start_new_session=True)
        self.reloads += 1

    def database_schema(self, filename):
        if not Path(filename).exists():
            return 0
        db = sqlite3.connect("file:" + str(filename) + "?mode=ro", uri=True)
        try:
            return db.execute("PRAGMA user_version").fetchone()[0]
        finally:
            db.close()

    def wait_health(self, release):
        if Path(release).name == self.fail_release:
            # Fault after actual activation; recovery still uses real health.
            raise DeploymentFault("HEALTH_FAILED")
        return super().wait_health(release)

    def close(self):
        self.stop()
        self.terminate(self.proxy)
        for file in self.files:
            file.close()


@unittest.skipUnless(os.environ.get("DEPLOY_TEST_RELEASE") and os.environ.get("DEPLOY_TEST_RELEASE_B")
                     and os.environ.get("DEPLOY_TEST_NGINX"), "set two real release paths and a local Nginx binary")
class NativeTransactionTests(unittest.TestCase):
    def test_real_install_repeat_update_configuration_recovery_and_persistence(self):
        with tempfile.TemporaryDirectory(prefix="atoms-native-deploy-") as temporary:
            base = Path(temporary).resolve()
            stage = base / "stage"
            stage.mkdir()
            packages = []
            for index, key in enumerate(("DEPLOY_TEST_RELEASE", "DEPLOY_TEST_RELEASE_B")):
                package = stage / ("package-" + str(index))
                shutil.copytree(os.environ[key], package, symlinks=True)
                packages.append(package)
            prefix = base / "nginx"
            prefix.mkdir()
            (prefix / "logs").mkdir()
            cert, key = base / "fixture.crt", base / "fixture.key"
            subprocess.run(["openssl", "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "2",
                "-keyout", str(key), "-out", str(cert), "-subj", "/CN=127.0.0.1",
                "-addext", "subjectAltName=IP:127.0.0.1"], check=True, capture_output=True, timeout=15)
            key.chmod(0o600)
            c = {"root": str(base / "owned"), "stage": str(stage), "run_id": str(uuid4()),
                 "node": shutil.which("node"), "node_version": "v" + (ROOT / ".nvmrc").read_text().strip(),
                 "pnpm_version": json.loads((ROOT / "package.json").read_text())["packageManager"],
                 "bridge": str(ROOT / "deploy/artifact.mjs"), "ip": "127.0.0.1", "backend_port": free_port(),
                 "https_port": free_port(), "nginx": os.environ["DEPLOY_TEST_NGINX"],
                 "site_path": str(prefix / "atoms.conf"), "unit_path": str(base / "atoms.service"),
                 "certificate": str(cert), "key": str(key), "environment": {}}
            self.assertNotEqual(c["backend_port"], c["https_port"])
            # Render exactly the production templates, including the API include.
            import jinja2
            engine = jinja2.Environment(loader=jinja2.FileSystemLoader(ROOT / "deploy/templates"), keep_trailing_newline=True)
            variables = {"atoms_root": c["root"], "ansible_host": c["ip"], "atoms_service_user": "fixture",
                         "atoms_service_group": "fixture", "atoms_config": {"https_port": c["https_port"],
                         "backend_port": c["backend_port"], "node_binary": c["node"], "tls_certificate": c["certificate"], "tls_key": c["key"]}}
            config = stage / "configuration"
            config.mkdir()
            for source, target in (("atoms-backend.service.j2", "atoms-backend.service"), ("nginx-site.conf.j2", "nginx-site.conf")):
                (config / target).write_text(engine.get_template(source).render(**variables))
            (prefix / "nginx.conf").write_text('daemon off;\npid "' + str(prefix / "nginx.pid") + '";\n'
                'error_log "' + str(prefix / "error.log") + '";\nevents {}\nhttp {\naccess_log off;\n'
                'types {text/html html; text/css css; application/javascript js; application/json json;}\n'
                'include "' + c["site_path"] + '";\n}\n')
            system = LocalProcesses(c, prefix)
            tx = Transaction(c, system)
            origin = "https://127.0.0.1:" + str(c["https_port"])
            cookies = http.cookiejar.CookieJar()
            client = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect(),
                urllib.request.HTTPCookieProcessor(cookies), urllib.request.HTTPSHandler(context=ssl.create_default_context(cafile=str(cert))))
            def api(route, payload=None):
                request = urllib.request.Request(origin + route, data=json.dumps(payload).encode() if payload is not None else None,
                    headers={"Origin": origin, "Content-Type": "application/json"})
                with client.open(request, timeout=5) as response:
                    return json.load(response)
            def apply(package):
                c["run_id"] = str(uuid4())
                return tx.apply(package)
            try:
                first = apply(packages[0])
                pid, counts = system.backend.pid, (system.starts, system.reloads)
                state = tx.state.read_bytes()
                api("/api/session", {})
                template = api("/api/templates")["items"][0]
                project = api("/api/projects", {"title": "Local deployment persistence", "templateId": template["id"],
                    "templateVersion": template["version"], "templateDigest": template["digest"]})
                project_id = project["project"]["id"]
                same = apply(packages[0])
                self.assertEqual(same["mode"], "noop")
                self.assertEqual((pid, counts, state), (system.backend.pid, (system.starts, system.reloads), tx.state.read_bytes()))
                # Update to another package actually produced by GEN-009.
                second = apply(packages[1])
                self.assertNotEqual(second["releaseId"], first["releaseId"])
                self.assertEqual(second["mode"], "activate")
                self.assertEqual(api("/api/projects/" + project_id)["currentVersion"], project["currentVersion"])
                self.assertTrue(list((Path(c["root"]) / "backups").glob("*/atoms.sqlite")))
                # Literal model configuration changes only the backend.
                c["environment"] = {"MODEL_ID": "offline-deployment-check"}
                counts = (system.starts, system.reloads)
                self.assertEqual(apply(packages[1])["mode"], "configure")
                self.assertEqual((system.starts, system.reloads), (counts[0] + 1, counts[1]))
                # Proxy-only update reloads the existing master, preserving Node.
                site = config / "nginx-site.conf"
                site.write_text(site.read_text() + "\n# local configuration update\n")
                pid, counts = system.backend.pid, (system.starts, system.reloads)
                self.assertEqual(apply(packages[1])["mode"], "configure")
                self.assertEqual((pid, system.starts, counts[1] + 1), (system.backend.pid, counts[0], system.reloads))
                # Bad Nginx config is rejected before stopping a healthy Node.
                good = site.read_bytes()
                site.write_bytes(good + b"atoms_invalid_directive;\n")
                with self.assertRaisesRegex(DeploymentFault, "NGINX_CONFIGURATION"):
                    apply(packages[1])
                self.assertEqual(system.backend.pid, pid)
                site.write_bytes(good)
                # An actual alternate release starts, then a controlled health
                # failure restores the compatible previous code/config/data.
                state = tx.state.read_bytes()
                system.fail_release = first["releaseId"]
                with self.assertRaisesRegex(DeploymentFault, "HEALTH_FAILED"):
                    apply(packages[0])
                self.assertEqual(tx.current_release().name, second["releaseId"])
                self.assertEqual(tx.state.read_bytes(), state)
                self.assertEqual(json.loads(tx.journal.read_text())["recovery"], "restored")
                self.assertEqual(api("/api/projects/" + project_id)["currentVersion"], project["currentVersion"])
                self.assertTrue(tx.status()["deploymentVerified"])
                system.fail_release = None
                self.assertEqual(apply(packages[1])["mode"], "noop")
            finally:
                system.close()


if __name__ == "__main__":
    unittest.main()
