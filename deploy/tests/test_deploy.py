"""Boundary tests use only synthetic configuration and isolated SSH fixtures."""

import importlib.util
import hashlib
from dataclasses import replace
import json
import os
from pathlib import Path
import shutil
import signal
import subprocess
import sys
import tempfile
import time
import unittest
from unittest.mock import patch
from uuid import uuid4

import psutil
import yaml


ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location("atoms_deploy", ROOT / "scripts/deploy.py")
adapter = importlib.util.module_from_spec(spec)
spec.loader.exec_module(adapter)
FAKE_PASSWORD = "fixture$'backslash\\)secret"


class Fixture(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="atoms deploy ")
        self.path = Path(self.temp.name)

    def tearDown(self):
        self.temp.cleanup()

    def cli(self, *args, env=None):
        return subprocess.run([str(ROOT / "deploy.sh"), *args], cwd=self.path,
                              env=env, text=True, capture_output=True, timeout=60)

    def inventory(self, **overrides):
        host = {"ansible_host": "203.0.113.10", "ansible_user": "ubuntu",
                "ansible_port": 22, "ansible_password": FAKE_PASSWORD, **overrides}
        file = self.path / "server.local.yml"
        file.write_text(yaml.safe_dump({"all": {"hosts": {"atoms": host}}}))
        file.chmod(0o600)
        return file

    def assert_safe(self, result):
        self.assertNotIn(FAKE_PASSWORD, result.stdout + result.stderr)


class EntryTests(Fixture):
    def test_prepared_bootstrap_is_offline_and_does_not_rewrite_environment(self):
        config = ROOT / ".tools/deploy/pyvenv.cfg"
        before = hashlib.sha256(config.read_bytes()).digest()
        for _ in range(2):
            result = self.cli("bootstrap", env={**os.environ, "PIP_NO_INDEX": "1"})
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            self.assertIn("already prepared", result.stdout)
            self.assertEqual(hashlib.sha256(config.read_bytes()).digest(), before)

    def test_help_and_apply_work_without_tools_from_other_directory(self):
        clone = self.path / "copy with spaces"
        (clone / "scripts").mkdir(parents=True)
        (clone / "deploy").mkdir()
        for source in ["deploy.sh", "scripts/deploy.py", "deploy/requirements.txt", "deploy/policy.py"]:
            shutil.copy2(ROOT / source, clone / source)
        for _ in range(2):
            help_result = subprocess.run([str(clone / "deploy.sh")], text=True, capture_output=True, check=True)
            self.assertIn("Usage:", help_result.stdout)
            result = subprocess.run([str(clone / "deploy.sh"), "apply", "--inventory", "/missing/private.yml"], text=True, capture_output=True)
            self.assertEqual(result.returncode, 2)
            self.assertIn("bootstrap", result.stderr)
            self.assertFalse((clone / ".tools").exists())
            self.assertFalse((clone / ".runtime").exists())

    def test_unknown_input_does_not_echo_supplied_values(self):
        result = self.cli("status", "--unknown", FAKE_PASSWORD)
        self.assertEqual(result.returncode, 2)
        self.assert_safe(result)

    def test_plan_is_offline_and_apply_validates_private_inputs(self):
        inventory = self.inventory()
        before = inventory.read_bytes()
        # Planning stays offline; apply validates private YAML before transport.
        inventory.write_text(FAKE_PASSWORD)
        for _ in range(2):
            result = self.cli("plan", "--json")
            self.assertEqual(result.returncode, 0, result.stderr)
            plan = json.loads(result.stdout)
            self.assertTrue(plan["implementationReady"])
            self.assertFalse(plan["targetVerified"])
            self.assertFalse(plan["deploymentVerified"])
            self.assertFalse(plan["releaseProvided"])
            self.assertEqual(len(plan["phases"]["block"]), 5)
            self.assertEqual(plan["pendingIntegrations"], [])
            self.assert_safe(result)
            blocked = self.cli("apply", "--json", "--inventory", str(inventory), "--release", FAKE_PASSWORD)
            self.assertEqual(blocked.returncode, 2)
            self.assertIn("Inventory must contain only", blocked.stderr)
            self.assert_safe(blocked)
            self.assertEqual(inventory.read_text(), FAKE_PASSWORD)
        inventory.write_bytes(before)

    def test_invalid_or_cleared_framework_dependencies_cannot_enable_apply(self):
        clone = self.path / "framework"
        shutil.copytree(ROOT / "deploy", clone / "deploy")
        dependencies = clone / "deploy/integrations.yml"
        for value in ["atoms_integrations: {}", "atoms_integrations: [" + FAKE_PASSWORD]:
            dependencies.write_text(value)
            with patch.object(adapter, "ROOT", clone):
                with self.assertRaises(adapter.InputError) as caught:
                    adapter.framework_plan()
                self.assertNotIn(FAKE_PASSWORD, str(caught.exception))

    def test_inventory_literal_value_and_permissions_are_preserved(self):
        file = self.inventory()
        original = file.read_bytes()
        self.assertEqual(adapter.inventory_path(str(file)), file)
        self.assertEqual(file.read_bytes(), original)
        self.assertEqual(yaml.safe_load(original)["all"]["hosts"]["atoms"]["ansible_password"], FAKE_PASSWORD)
        file.chmod(0o644)
        result = self.cli("check", "--inventory", str(file))
        self.assertEqual(result.returncode, 2)
        self.assertIn("0600", result.stderr)
        self.assert_safe(result)

    def test_symlinks_malformed_yaml_and_unsafe_parameters_are_rejected(self):
        file = self.inventory()
        link = self.path / "linked.yml"
        link.symlink_to(file)
        with self.assertRaises(adapter.InputError):
            adapter.inventory_path(str(link))
        for override in [{"ansible_connection": "local"}, {"ansible_host": "203.0.113.10;false"},
                         {"atoms_https_port": 22}, {"atoms_node_binary": "/tmp/../evil"},
                         {"ansible_password": "{{lookup('pipe','false')}}"}]:
            self.inventory(**override)
            result = self.cli("status", "--inventory", str(file))
            self.assertEqual(result.returncode, 2)
            self.assert_safe(result)
        file.write_text("all: [bad YAML: [" + FAKE_PASSWORD)
        result = self.cli("status", "--inventory", str(file))
        self.assertEqual(result.returncode, 2)
        self.assert_safe(result)
        file.write_text("all:\n  hosts:\n    atoms:\n      ansible_password: placeholder\n      ansible_password: " + FAKE_PASSWORD + "\n")
        result = self.cli("status", "--inventory", str(file))
        self.assertEqual(result.returncode, 2)
        self.assertIn("Duplicate", result.stderr)
        self.assert_safe(result)

    def test_runtime_environment_cannot_enable_ansible_debug_or_plugins(self):
        os.environ["ANSIBLE_DEBUG"] = "1"
        os.environ["ANSIBLE_STDOUT_CALLBACK"] = "nonexistent"
        try:
            env = adapter.clean_environment()
            self.assertEqual(env["ANSIBLE_DEBUG"], "0")
            self.assertNotIn("ANSIBLE_STDOUT_CALLBACK", env)
        finally:
            os.environ.pop("ANSIBLE_DEBUG")
            os.environ.pop("ANSIBLE_STDOUT_CALLBACK")

    def test_password_transport_requires_working_sshpass_but_private_key_does_not(self):
        password = self.inventory()
        with patch.object(adapter.shutil, "which", return_value=None):
            with self.assertRaisesRegex(adapter.InputError, "requires sshpass"):
                adapter.require_password_transport(password)
        key = self.inventory(ansible_password=None, ansible_ssh_private_key_file="~/.ssh/fixture")
        data = yaml.safe_load(key.read_text())
        del data["all"]["hosts"]["atoms"]["ansible_password"]
        key.write_text(yaml.safe_dump(data))
        with patch.object(adapter.shutil, "which", return_value=None):
            adapter.require_password_transport(key)
        with patch.object(adapter.shutil, "which", return_value="/fixture/sshpass"), patch.object(
                adapter.subprocess, "run", return_value=subprocess.CompletedProcess([], 0, "sshpass 1.05\n", "")):
            with self.assertRaisesRegex(adapter.InputError, "working sshpass"):
                adapter.require_sshpass()

    def test_external_password_environment_is_not_forwarded(self):
        with patch.dict(os.environ, {"SSHPASS": FAKE_PASSWORD, "SSH_ASKPASS": "/fixture/askpass",
                                    "ANSIBLE_SSH_PASSWORD_MECHANISM": "ssh_askpass"}):
            env = adapter.clean_environment()
            for key in ("SSHPASS", "SSH_ASKPASS", "ANSIBLE_SSH_PASSWORD_MECHANISM"):
                self.assertNotIn(key, env)
            with patch.object(adapter.shutil, "which", return_value="/fixture/sshpass"), patch.object(
                    adapter.subprocess, "run", return_value=subprocess.CompletedProcess([], 0, "sshpass 1.06\n", "")) as run:
                adapter.require_sshpass()
                for key in ("SSHPASS", "SSH_ASKPASS", "ANSIBLE_SSH_PASSWORD_MECHANISM"):
                    self.assertNotIn(key, run.call_args.kwargs["env"])


class AnsibleTests(Fixture):
    def ssh_environment(self, hang=False):
        stub = self.path / "ssh"
        marker = self.path / "ssh-result.json"
        stub.write_text(f'''#!{sys.executable}
import json,os,pathlib,sys,termios,time
if '-V' in sys.argv:
 sys.stderr.write('OpenSSH_9.9');sys.exit(0)
fd=os.open('/dev/tty',os.O_RDWR)
before=termios.tcgetattr(fd);quiet=before.copy();quiet[3]&=~termios.ECHO
termios.tcsetattr(fd,termios.TCSANOW,quiet)
os.write(fd,b'fixture password: ')
received=bytearray()
while True:
 char=os.read(fd,1)
 if not char or char[0] in (10,13):break
 received.extend(char)
termios.tcsetattr(fd,termios.TCSANOW,before);os.close(fd)
password=received.decode()
pathlib.Path({str(marker)!r}).write_text(json.dumps({{'pid':os.getpid(),'literal_matches':password=={FAKE_PASSWORD!r},
 'password_not_in_argv':all(password not in arg for arg in sys.argv),
 'password_not_in_env':all(password not in value for value in os.environ.values()),
 'no_askpass':not bool(os.environ.get('SSH_ASKPASS'))}}))
if {hang!r}:time.sleep(120)
sys.stderr.write({FAKE_PASSWORD!r}+' Permission denied (publickey,password).')
sys.exit(255)
''')
        stub.chmod(0o700)
        return {**os.environ, "PATH": str(self.path) + os.pathsep + os.environ["PATH"],
                "ANSIBLE_DEBUG": "1", "ANSIBLE_VERBOSITY": "4"}, marker

    def test_real_ansible_auth_transport_and_failure_do_not_leak_password(self):
        inventory = self.inventory()
        original = inventory.read_bytes()
        env, marker = self.ssh_environment()
        for command in ("check", "status"):
            result = self.cli(command, "--inventory", str(inventory), env=env)
            self.assertNotEqual(result.returncode, 0)
            self.assertTrue(marker.exists(), result.stdout + result.stderr)
            self.assertTrue(json.loads(marker.read_text())["literal_matches"])
            observed = json.loads(marker.read_text())
            for key in ("password_not_in_argv", "password_not_in_env", "no_askpass"):
                self.assertTrue(observed[key], key)
            self.assert_safe(result)
            if command == "check":
                self.assertIn("censored", result.stdout)
            else:
                evidence = result.stdout.split("Evidence: ")[-1].strip()
                log = (ROOT / evidence / "ansible.log").read_text()
                self.assertIn("censored", log)
                self.assertNotIn(FAKE_PASSWORD, log)
            self.assertEqual(inventory.read_bytes(), original)

    def check_cancel(self, signum):
        inventory = self.inventory()
        env, marker = self.ssh_environment(hang=True)
        unrelated = subprocess.Popen([sys.executable, "-c", "import time;time.sleep(120)"])
        process = subprocess.Popen([str(ROOT / "deploy.sh"), "status", "--inventory", str(inventory)],
                                   env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        try:
            deadline = time.monotonic() + 20
            while not marker.exists() and process.poll() is None and time.monotonic() < deadline:
                time.sleep(0.05)
            self.assertTrue(marker.exists())
            child = psutil.Process(json.loads(marker.read_text())["pid"])
            process.send_signal(signum)
            stdout, stderr = process.communicate(timeout=15)
            self.assertEqual(process.returncode, 128 + signum, stdout + stderr)
            self.assertFalse(child.is_running())
            self.assertIsNone(unrelated.poll())
            self.assertNotIn(FAKE_PASSWORD, stdout + stderr)
        finally:
            if process.poll() is None:
                adapter.stop_owned_processes(process)
                process.wait(timeout=10)
            unrelated.terminate()
            unrelated.wait(timeout=5)

    def test_signals_stop_detached_ssh_without_touching_other_processes(self):
        for signum in (signal.SIGINT, signal.SIGTERM):
            with self.subTest(signal=signum):
                marker = self.path / "ssh-result.json"
                marker.unlink(missing_ok=True)
                self.check_cancel(signum)

    def test_timeout_cleans_owned_detached_descendants(self):
        marker = self.path / "descendant.json"
        child_code = f"import os,json,pathlib,time;pathlib.Path({str(marker)!r}).write_text(json.dumps({{'pid':os.getpid()}}));time.sleep(120)"
        parent_code = f"import subprocess,time;subprocess.Popen([{sys.executable!r},'-c',{child_code!r}],start_new_session=True);time.sleep(120)"
        code = adapter.run([sys.executable, "-c", parent_code], timeout=0.5)
        self.assertEqual(code, 124)
        self.assertTrue(marker.exists())
        self.assertFalse(psutil.pid_exists(json.loads(marker.read_text())["pid"]))

    def test_real_template_render_is_idempotent_and_contains_no_credentials(self):
        names = ["nginx-site.conf", "atoms-backend.service", "backend.env"]
        play = [{"hosts": "localhost", "connection": "local", "gather_facts": False,
                 "vars_files": [str(ROOT / "deploy/defaults.yml")],
                 "vars": {"ansible_host": "203.0.113.10", "atoms_https_port": 9443, "atoms_backend_port": 39001},
                 "tasks": [{"name": "Render isolated production template", "ansible.builtin.template": {
                     "src": str(ROOT / "deploy/templates" / (name + ".j2")),
                     "dest": str(self.path / name), "mode": "0600"}, "no_log": True} for name in names]}]
        source = self.path / "render.yml"
        source.write_text(json.dumps(play))
        command = [str(ROOT / ".tools/deploy/bin/ansible-playbook"), "-i", "localhost,", str(source)]
        for attempt in range(2):
            result = subprocess.run(command, cwd=ROOT, env=adapter.clean_environment(), capture_output=True, text=True, timeout=30)
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            if attempt:
                self.assertIn("changed=0", result.stdout)
        nginx = (self.path / names[0]).read_text()
        self.assertIn("listen 9443 ssl;", nginx)
        self.assertIn("proxy_pass http://127.0.0.1:39001;", nginx)
        self.assertIn("proxy_set_header Host $http_host;", nginx)
        self.assertIn("APP_ORIGINS=https://203.0.113.10:9443", (self.path / "backend.env").read_text())
        for name in names:
            self.assertNotIn(FAKE_PASSWORD, (self.path / name).read_text())
            self.assertEqual((self.path / name).stat().st_mode & 0o777, 0o600)

    def test_direct_apply_playbook_also_refuses_without_remote_operations(self):
        env, marker = self.ssh_environment()
        clean = adapter.clean_environment()
        clean["PATH"] = env["PATH"]
        for extra in [None, {"atoms_pending_integrations": {}}]:
            command = [str(ROOT / ".tools/deploy/bin/ansible-playbook"), "-i", "atoms,", str(ROOT / "deploy/apply.yml")]
            if extra is not None:
                command += ["-e", json.dumps(extra)]
            result = subprocess.run(command, cwd=ROOT, env=clean, capture_output=True, text=True, timeout=20)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("DEP-003", result.stdout)
            self.assertFalse(marker.exists(), "Dependency gate must run without SSH.")

    def local_observation(self, command, busy=False, unknown=False):
        # Real builtin modules run locally; only OS commands/facts are fixtures.
        versions = {"node": "v" + (ROOT / ".nvmrc").read_text().strip(),
                    "pnpm": json.loads((ROOT / "package.json").read_text())["packageManager"].split("@")[1]}
        for name in ["node", "pnpm", "nginx", "systemctl", "ss", "sudo"]:
            file = self.path / name
            file.write_text(f'''#!{sys.executable}
import os,sys
name={name!r}
if name in {versions!r}:print({versions!r}[name])
elif name=='systemctl':sys.exit({5 if unknown else 0})
elif name=='ss':print({'LISTEN 0 128 0.0.0.0:8443 0.0.0.0:*' if busy else ''!r})
elif name=='sudo' and sys.argv[2] not in ['openssl','test']:os.execvp(sys.argv[2],sys.argv[2:])
''')
            file.chmod(0o700)
        inventory = self.inventory(**{f"atoms_{name}_binary": str(self.path / name) for name in ["node", "pnpm", "nginx"]})
        # Direct playbook test bypasses the production CLI's SSH-only boundary.
        extra = {"ansible_connection": "local", "ansible_python_interpreter": sys.executable,
                 "ansible_facts": {"distribution": "Ubuntu", "service_mgr": "systemd"}}
        env = adapter.clean_environment()
        env["PATH"] = str(self.path) + os.pathsep + env["PATH"]
        return subprocess.run([str(ROOT / ".tools/deploy/bin/ansible-playbook"), "-i", str(inventory),
                               "-e", json.dumps(extra), str(ROOT / f"deploy/{command}.yml")],
                              cwd=ROOT, env=env, capture_output=True, text=True, timeout=30)

    def test_prerequisite_report_distinguishes_pass_and_port_conflict(self):
        result = self.local_observation("check")
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn('"deployment_verified": false', result.stdout)
        conflict = self.local_observation("check", busy=True)
        self.assertNotEqual(conflict.returncode, 0, conflict.stdout + conflict.stderr)
        self.assertIn('"first_deploy_ports_free": false', conflict.stdout)
        self.assert_safe(conflict)

    def test_status_reports_running_and_unknown_without_certifying_health(self):
        result = self.local_observation("status")
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn('"backend_active": true', result.stdout)
        self.assertIn('"deployment_verified": false', result.stdout)
        unknown = self.local_observation("status", unknown=True)
        self.assertNotEqual(unknown.returncode, 0)
        self.assertIn('"backend_active": null', unknown.stdout)
        self.assert_safe(unknown)

    def test_configuration_stage_is_idempotent_and_preserves_live_secrets(self):
        shutil.copytree(ROOT / "deploy/templates", self.path / "templates")
        service = self.path / "owned service"
        phase = [{"hosts": "localhost", "connection": "local", "gather_facts": False,
                  "vars_files": [str(ROOT / "deploy/defaults.yml")],
                  "tasks": [{"ansible.builtin.import_tasks": str(ROOT / "deploy/tasks/configure.yml")}]}]
        source = self.path / "stage.yml"
        source.write_text(json.dumps(phase))
        extra = {"atoms_root": str(service), "ansible_host": "203.0.113.10",
                 "ansible_python_interpreter": sys.executable}
        command = [str(ROOT / ".tools/deploy/bin/ansible-playbook"), "-i", "localhost,", str(source), "-e", json.dumps(extra)]
        def stage():
            return subprocess.run(command, cwd=ROOT, env=adapter.clean_environment(), capture_output=True, text=True, timeout=30)
        first = stage()
        self.assertEqual(first.returncode, 0, first.stdout + first.stderr)
        pending = service / "shared/config/pending"
        self.assertTrue((pending / "backend.env").is_file())
        self.assertEqual(pending.stat().st_mode & 0o777, 0o700)
        again = stage()
        self.assertEqual(again.returncode, 0, again.stdout + again.stderr)
        self.assertIn("changed=0", again.stdout)
        live = service / "shared/config/backend.env"
        live.write_text("PRIVATE_FIXTURE=" + FAKE_PASSWORD)
        live.chmod(0o600)
        original = live.read_bytes()
        preserved = stage()
        self.assertEqual(preserved.returncode, 0, preserved.stdout + preserved.stderr)
        self.assertEqual(live.read_bytes(), original)
        self.assertFalse((pending / "backend.env").exists())
        self.assert_safe(preserved)
        repeated = stage()
        self.assertEqual(repeated.returncode, 0, repeated.stdout + repeated.stderr)
        self.assertIn("changed=0", repeated.stdout)
        live.unlink()
        live.symlink_to(self.path / "unowned.env")
        (self.path / "unowned.env").write_bytes(original)
        refused = stage()
        self.assertNotEqual(refused.returncode, 0)
        self.assertEqual((self.path / "unowned.env").read_bytes(), original)
        self.assert_safe(refused)
        live.unlink()
        live.write_bytes(original)
        outside = self.path / "unowned directory"
        outside.mkdir()
        pending.rename(pending.with_name("previous-pending"))
        pending.symlink_to(outside, target_is_directory=True)
        refused_directory = stage()
        self.assertNotEqual(refused_directory.returncode, 0)
        self.assertEqual(list(outside.iterdir()), [])
        self.assertEqual(live.read_bytes(), original)

    def test_native_rescue_and_always_keep_a_failure_as_failure(self):
        shutil.copytree(ROOT / "deploy", self.path / "deploy")
        apply = yaml.safe_load((self.path / "deploy/apply.yml").read_text())
        # Only the isolated fixture removes the production gate and substitutes
        # its first stage. There is no production CLI or environment bypass.
        apply[0].pop("pre_tasks")
        apply[0].update(hosts="localhost", connection="local")
        file = self.path / "deploy/apply.yml"
        file.write_text(yaml.safe_dump(apply))
        (self.path / "deploy/tasks/preflight.yml").write_text(
            "- name: Isolated fixture failure\n  ansible.builtin.fail:\n    msg: Fixture failure\n")
        result = subprocess.run([str(ROOT / ".tools/deploy/bin/ansible-playbook"), "-i", "localhost,", str(file)],
                                cwd=ROOT, env=adapter.clean_environment(), capture_output=True, text=True, timeout=20)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("Keep transaction failure visible", result.stdout)
        self.assertIn("Clean only this command", result.stdout)


class UpdatePolicyTests(unittest.TestCase):
    def setUp(self):
        self.original = adapter.DeploymentIdentity(str(uuid4()), "a" * 64, "b" * 64, "c" * 64)

    def decide(self, current, desired, backend=True, proxy=True):
        return adapter.decide_update(current, desired, backend_healthy=backend, proxy_healthy=proxy)

    def test_healthy_repeat_does_not_rebuild_switch_restart_or_restore(self):
        decision = self.decide(self.original, self.original)
        self.assertEqual(decision["mode"], "noop")
        for name in ["switch_release", "restart_backend", "reload_proxy", "build_release", "restore_database"]:
            self.assertFalse(decision[name])
        self.assertTrue(decision["verify_health"])

    def test_new_install_and_new_release_require_activation_and_backup_checks(self):
        self.assertEqual(self.decide(None, self.original, False, False)["mode"], "install")
        desired = replace(self.original, release_id=str(uuid4()), content_digest="d" * 64)
        decision = self.decide(self.original, desired)
        self.assertEqual(decision["mode"], "activate")
        for name in ["switch_release", "restart_backend", "reload_proxy", "require_cold_backup_check"]:
            self.assertTrue(decision[name])
        self.assertFalse(decision["restore_database"])

    def test_backend_and_proxy_configuration_are_independent_of_release_id(self):
        backend = self.decide(self.original, replace(self.original, backend_config_digest="d" * 64))
        self.assertEqual(backend["mode"], "configure")
        self.assertTrue(backend["restart_backend"])
        self.assertFalse(backend["reload_proxy"])
        self.assertFalse(backend["switch_release"])
        proxy = self.decide(self.original, replace(self.original, proxy_config_digest="e" * 64))
        self.assertTrue(proxy["reload_proxy"])
        self.assertFalse(proxy["restart_backend"])
        self.assertFalse(proxy["require_cold_backup_check"])

    def test_unhealthy_same_release_repairs_only_the_affected_service(self):
        backend = self.decide(self.original, self.original, False, True)
        self.assertEqual(backend["mode"], "repair")
        self.assertTrue(backend["restart_backend"])
        self.assertFalse(backend["switch_release"])
        self.assertFalse(backend["reload_proxy"])
        proxy = self.decide(self.original, self.original, True, False)
        self.assertFalse(proxy["restart_backend"])
        self.assertTrue(proxy["reload_proxy"])

    def test_content_conflict_unknown_health_and_invalid_identity_fail_closed(self):
        with self.assertRaises(adapter.InputError):
            self.decide(self.original, replace(self.original, content_digest="d" * 64))
        with self.assertRaises(adapter.InputError):
            self.decide(self.original, self.original, None, True)
        with self.assertRaises(adapter.InputError):
            adapter.DeploymentIdentity(FAKE_PASSWORD, "a" * 64, "b" * 64, "c" * 64)


if __name__ == "__main__":
    unittest.main()
