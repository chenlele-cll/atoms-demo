"""Ubuntu system integration. Tests inject an owned local process adapter."""
import grp
import json
import os
from pathlib import Path
import pwd
import re
import signal
import ssl
import subprocess
import time
import urllib.request
import urllib.error

from storage import DeploymentFault, digest, parse_environment, regular, write_json


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


class System:
    def __init__(self, context):
        self.c = context

    def run(self, args, timeout=30):
        env = {key: value for key, value in os.environ.items() if key in ("LANG", "LC_ALL")}
        env["PATH"] = "/usr/sbin:/usr/bin:/sbin:/bin"
        env.update(NODE_OPTIONS="", NODE_PATH="", COREPACK_ENABLE_NETWORK="0", COREPACK_ENABLE_AUTO_PIN="0")
        process = subprocess.Popen([str(arg) for arg in args], stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                   env=env, start_new_session=True)
        try:
            stdout, _ = process.communicate(timeout=timeout)
            return process.returncode, stdout
        except BaseException:
            try:
                os.killpg(process.pid, signal.SIGTERM)
                process.communicate(timeout=3)
            except (ProcessLookupError, subprocess.TimeoutExpired):
                try:
                    os.killpg(process.pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
                process.communicate()
            raise

    def checked(self, args, code, timeout=30):
        status, output = self.run(args, timeout)
        if status:
            raise DeploymentFault(code)
        return output

    def bridge(self, action, release, extra=None):
        args = [self.c["node"], self.c["bridge"], action, str(release)]
        if extra is not None:
            args.append(str(extra))
        output = self.checked(args, "RELEASE_INVALID", timeout=90)
        try:
            value = json.loads(output)
            if value.get("ok") is not True:
                raise ValueError
            return value
        except (ValueError, AttributeError):
            raise DeploymentFault("RELEASE_INVALID") from None

    def model_configuration(self, release, environment):
        """Validate with the selected application's parser; never call a provider."""
        values = parse_environment(environment)
        if not values.get("OPENAI_API_KEY", "").strip():
            return  # Models remain optional for diagnostics-only installations.
        filename = Path(self.c["stage"]) / "model-environment.json"
        write_json(filename, values)
        script = ("import {readFileSync} from 'node:fs';import {pathToFileURL} from 'node:url';"
                  "import path from 'node:path';"
                  "const env=JSON.parse(readFileSync(process.argv[2],'utf8'));"
                  "const {readModelConfig}=await import(pathToFileURL(path.join(process.argv[1],"
                  "'backend/dist/model/config.js')).href);"
                  "try{readModelConfig(env);}catch{process.exitCode=2;}")
        try:
            self.checked([self.c["node"], "--input-type=module", "-e", script,
                          str(release), str(filename)], "MODEL_CONFIGURATION")
        finally:
            filename.unlink(missing_ok=True)

    def unit(self, name):
        code, output = self.run(["systemctl", "show", name, "--property=LoadState,MainPID,ActiveState,FragmentPath,DropInPaths"])
        values = dict(line.split("=", 1) for line in output.decode().splitlines() if "=" in line)
        if code and not (name == "atoms-backend.service" and values.get("LoadState") == "not-found"):
            raise DeploymentFault("SERVICE_INSPECTION_FAILED")
        return values

    def active(self, name):
        return self.unit(name).get("ActiveState") == "active"

    def machine(self):
        return digest(Path("/etc/machine-id").read_bytes())

    def preflight(self):
        if os.geteuid() != 0:
            raise DeploymentFault("SUDO_REQUIRED")
        release = Path("/etc/os-release").read_text()
        if not re.search(r'^ID=(?:"Ubuntu"|"ubuntu"|ubuntu)$', release, re.M) or not Path("/run/systemd/system").is_dir():
            raise DeploymentFault("UNSUPPORTED_TARGET")
        if self.checked([self.c["node"], "--version"], "NODE_REQUIRED").decode().strip() != self.c["node_version"]:
            raise DeploymentFault("NODE_VERSION")
        node_path = Path(self.c["node"]).resolve()
        if str(node_path).startswith(("/home/", "/root/")) or node_path.stat().st_uid != 0 or node_path.stat().st_mode & 0o022:
            raise DeploymentFault("UNSAFE_NODE_PATH")
        self.checked([self.c["nginx"], "-t"], "NGINX_CONFIGURATION")
        if not self.active("nginx.service"):
            raise DeploymentFault("NGINX_REQUIRED")
        self.checked(["openssl", "verify", "-purpose", "sslserver", "-verify_ip", self.c["ip"],
                      "-untrusted", self.c["certificate"], self.c["certificate"]], "TLS_CERTIFICATE")
        self.checked(["openssl", "x509", "-noout", "-checkend", "86400", "-in", self.c["certificate"]], "TLS_EXPIRY")
        regular(Path(self.c["key"]).resolve(strict=True))
        unit = self.unit("atoms-backend.service")
        if not Path(self.c["site_path"]).parent.is_dir() or not Path(self.c["unit_path"]).parent.is_dir():
            raise DeploymentFault("CONFIGURATION_DIRECTORY_REQUIRED")
        if unit.get("DropInPaths"):
            raise DeploymentFault("UNOWNED_SERVICE")
        if unit.get("FragmentPath") and unit["FragmentPath"] != self.c["unit_path"]:
            raise DeploymentFault("UNOWNED_SERVICE")

    def check_ports(self, owned_proxy):
        output = self.checked(["ss", "-H", "-lntp"], "PORT_INSPECTION").decode()
        backend_pid = int(self.unit("atoms-backend.service").get("MainPID", "0"))
        nginx_pid = int(self.unit("nginx.service").get("MainPID", "0"))
        descendants = {nginx_pid} if nginx_pid else set()
        # Only /proc parent identities are read, never command/environment data.
        parents = {}
        for item in Path("/proc").iterdir():
            if not item.name.isdigit():
                continue
            try:
                value = (item / "stat").read_text().rsplit(")", 1)[1].split()
                parents[int(item.name)] = int(value[1])
            except (OSError, ValueError, IndexError):
                continue
        for _ in range(4):
            descendants.update(pid for pid, parent in parents.items() if parent in descendants)
        for port, allowed in [(self.c["backend_port"], {backend_pid} if backend_pid else set()),
                              (self.c["https_port"], descendants if owned_proxy else set())]:
            for line in output.splitlines():
                columns = line.split()
                if len(columns) > 3 and re.search(r":" + str(port) + r"$", columns[3]):
                    pids = {int(pid) for pid in re.findall(r"pid=(\d+)", line)}
                    if not pids or not pids <= allowed:
                        raise DeploymentFault("PORT_CONFLICT")

    def ensure_user(self):
        try:
            user = pwd.getpwnam("atoms")
            if user.pw_uid >= 1000 or user.pw_shell not in ("/usr/sbin/nologin", "/sbin/nologin"):
                raise DeploymentFault("UNOWNED_SERVICE_USER")
        except KeyError:
            self.checked(["useradd", "--system", "--user-group", "--no-create-home", "--home-dir", "/nonexistent",
                          "--shell", "/usr/sbin/nologin", "atoms"], "SERVICE_USER")
            user = pwd.getpwnam("atoms")
        return user.pw_uid, grp.getgrnam("atoms").gr_gid

    def stop(self):
        if self.unit("atoms-backend.service").get("LoadState") == "not-found":
            return
        self.checked(["systemctl", "stop", "atoms-backend.service"], "BACKEND_STOP")
        if self.active("atoms-backend.service"):
            raise DeploymentFault("BACKEND_STOP")

    def start(self):
        self.checked(["systemctl", "daemon-reload"], "UNIT_RELOAD")
        state = self.unit("atoms-backend.service").get("ActiveState")
        reset, _ = self.run(["systemctl", "reset-failed", "atoms-backend.service"])
        # Ubuntu may garbage-collect a new inactive unit immediately, making
        # reset-failed return 1. A genuinely failed loaded unit must reset.
        if reset and state == "failed":
            raise DeploymentFault("UNIT_RESET")
        self.checked(["systemctl", "enable", "atoms-backend.service"], "UNIT_ENABLE")
        self.checked(["systemctl", "start", "atoms-backend.service"], "BACKEND_START")

    def nginx_test(self):
        self.checked([self.c["nginx"], "-t"], "NGINX_CONFIGURATION")
        text = self.checked([self.c["nginx"], "-T"], "NGINX_CONFIGURATION").decode()
        if "# configuration file " + self.c["site_path"] + ":" not in text:
            raise DeploymentFault("NGINX_SITE_NOT_INCLUDED")

    def reload_proxy(self):
        self.checked(["systemctl", "reload", "nginx.service"], "NGINX_RELOAD")

    def database_schema(self, filename):
        if not Path(filename).exists():
            return 0
        code = "import sqlite3,sys,urllib.parse;d=sqlite3.connect('file:'+urllib.parse.quote(sys.argv[1])+'?mode=ro',uri=True);print(d.execute('pragma user_version').fetchone()[0]);d.close()"
        data = self.checked(["runuser", "-u", "atoms", "--", "python3", "-c", code, str(filename)], "DATABASE_INSPECTION")
        try:
            return int(data.strip())
        except ValueError:
            raise DeploymentFault("DATABASE_INSPECTION") from None

    def backend_matches(self, release):
        if not self.active("atoms-backend.service"):
            return False
        pid = int(self.unit("atoms-backend.service")["MainPID"])
        return Path("/proc", str(pid), "cwd").resolve() == (Path(release) / "backend").resolve()

    def health(self, release, public=True):
        try:
            if not self.backend_matches(release):
                return False
            url = ("https://" + self.c["ip"] + ":" + str(self.c["https_port"]) if public else
                   "http://127.0.0.1:" + str(self.c["backend_port"]))
            opener = self.opener()
            with opener.open(url + "/api/health", timeout=4) as response:
                if response.status != 200 or response.geturl() != url + "/api/health":
                    return False
                body = response.read(4097)
            if len(body) > 4096 or json.loads(body) != {"status": "ok", "service": "atoms-backend"}:
                return False
            # A healthy SPA fallback must not hide an incorrectly routed API.
            try:
                opener.open(url + "/api/atoms-deployment-missing", timeout=4).close()
                return False
            except urllib.error.HTTPError as response:
                with response:
                    body = response.read(4097)
                    value = json.loads(body) if len(body) <= 4096 else {}
                    return (response.code == 404 and isinstance(value, dict)
                            and isinstance(value.get("error"), dict) and value["error"].get("code") == "NOT_FOUND")
        except (OSError, ValueError, KeyError):
            return False

    def proxy_health(self, release):
        try:
            if not self.active("nginx.service"):
                return False
            url = "https://" + self.c["ip"] + ":" + str(self.c["https_port"])
            opener = self.opener()
            with opener.open(url + "/", timeout=4) as response:
                body = response.read(1024 * 1024 + 1)
                if response.status != 200 or response.geturl() != url + "/" or len(body) > 1024 * 1024:
                    return False
            return digest(body) == digest((Path(release) / "frontend/index.html").read_bytes())
        except (OSError, ValueError):
            return False

    def wait_health(self, release):
        deadline = time.monotonic() + 45
        while time.monotonic() < deadline:
            if self.health(release, False) and self.health(release, True) and self.proxy_health(release):
                return
            time.sleep(1)
        raise DeploymentFault("HEALTH_FAILED")

    def opener(self):
        return urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect(),
                                           urllib.request.HTTPSHandler(context=ssl.create_default_context()))
