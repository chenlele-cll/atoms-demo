"""Control dispatch, public result projection and raw private configuration."""
import contextlib
import io
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
from types import SimpleNamespace
import unittest
from uuid import uuid4

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "deploy"))
import controller
from policy import InputError
from test_transaction import package


class ControllerTests(unittest.TestCase):
    def test_dispatch_uses_real_apply_playbook_and_private_request_file(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            for name in (".nvmrc", "package.json", "deploy/artifact.mjs", "scripts/release/artifact.mjs",
                         "scripts/verification/primitives.mjs", "deploy/policy.py", "deploy/storage.py",
                         "deploy/system.py", "deploy/runtime.py", "deploy/remote.py"):
                target = root / name
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes((ROOT / name).read_bytes())
            inventory = root / "private.yml"
            inventory.write_text("unused transport fixture")
            secret = 'literal\\){{lookup-not-evaluated}}$"value'
            env = root.parent / ("private-model-" + str(uuid4()) + ".yml")
            try:
                import yaml
                env.write_text(yaml.safe_dump({"OPENAI_API_KEY": secret}))
                env.chmod(0o600)
                options = SimpleNamespace(release=None, release_id=str(uuid4()), env_file=str(env), json=True)
                def runner(command, timeout, log_path):
                    self.assertEqual(command[-1], str(root / "deploy/apply.yml"))
                    self.assertEqual(timeout, 2100)
                    self.assertNotIn(secret, " ".join(command))
                    request_file = Path(command[command.index("--extra-vars") + 1][1:])
                    request = json.loads(request_file.read_text())["atoms_request"]
                    self.assertEqual(request["mode"], "retained")
                    self.assertNotIn("archive", request)
                    self.assertNotIn(secret, request_file.read_text())
                    self.assertEqual(json.loads(Path(request["environment_file"]).read_text()), {"OPENAI_API_KEY": secret})
                    self.assertEqual(request_file.stat().st_mode & 0o777, 0o600)
                    Path(request["result_file"]).write_text(json.dumps({"ok": True, "status": "passed", "mode": "noop",
                        "changed": False, "releaseId": options.release_id, "releaseDigest": "1" * 64, "deploymentVerified": True,
                        "unknownPrivateValue": secret}))
                    return 0
                output = io.StringIO()
                with contextlib.redirect_stdout(output):
                    self.assertEqual(controller.execute(root, options, inventory, runner), 0)
                self.assertNotIn(secret, output.getvalue())
                self.assertTrue(json.loads(output.getvalue())["deploymentVerified"])
                # A fetched preflight/success-looking record must never mask
                # Ansible failure before the final pipeline completes.
                def failed_runner(command, timeout, log_path):
                    runner(command, timeout, log_path)
                    return 2
                output = io.StringIO()
                with contextlib.redirect_stdout(output):
                    self.assertEqual(controller.execute(root, options, inventory, failed_runner), 2)
                failed = json.loads(output.getvalue())
                self.assertFalse(failed["deploymentVerified"])
                self.assertEqual(failed["code"], "TARGET_PIPELINE_FAILED")
                self.assertNotIn(secret, output.getvalue())
            finally:
                env.unlink(missing_ok=True)

    def test_private_patch_rejects_duplicates_bad_permissions_and_public_repo_file(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            subprocess.run(["git", "init", "-q", str(root)], check=True, capture_output=True)
            file = root / "public.yml"
            file.write_text("MODEL_ID: fixture\n")
            file.chmod(0o600)
            with self.assertRaises(InputError):
                controller.environment_patch(file, root)
            (root / ".gitignore").write_text("public.yml\n")
            self.assertEqual(controller.environment_patch(file, root), {"MODEL_ID": "fixture"})
            file.write_text("MODEL_ID: first\nMODEL_ID: second\n")
            with self.assertRaises(InputError):
                controller.environment_patch(file, root)
            file.write_text("MODEL_ID: fixture\n")
            file.chmod(0o644)
            with self.assertRaises(InputError):
                controller.environment_patch(file, root)

    def test_public_projection_rejects_secret_in_known_field(self):
        for field in ("status", "mode", "code", "releaseId", "releaseDigest", "healthy"):
            with self.subTest(field=field), self.assertRaises((ValueError, TypeError, AttributeError)):
                controller.public_result({"ok": False, field: "private-fixture-value"})

    def test_explicit_native_package_is_validated_and_cannot_cross_to_ubuntu(self):
        with tempfile.TemporaryDirectory() as directory:
            release = package(Path(directory))
            identity = controller.artifact(ROOT, "metadata", release)
            self.assertTrue(identity["ok"])
            if identity["platform"] != "linux":
                with self.assertRaisesRegex(InputError, "Linux-built"):
                    controller.explicit_release(ROOT, release)
            (release / "frontend/index.html").write_text("tampered")
            with self.assertRaises(InputError):
                controller.artifact(ROOT, "metadata", release)

    def test_source_snapshot_reuses_producer_selection_and_excludes_private_files(self):
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "public-source"
            value = controller.artifact(ROOT, "snapshot", ROOT, source)
            self.assertGreater(value["count"], 10)
            self.assertEqual(len(value["sourceDigest"]), 64)
            self.assertTrue((source / "scripts/release.mjs").is_file())
            for name in ("server.local.yml", "backend/.env", ".git", ".runtime", "test-results", "deploy.env.local.yml"):
                self.assertFalse((source / name).exists(), name)
            self.assertFalse(any(item.is_symlink() for item in source.rglob("*")))


if __name__ == "__main__":
    unittest.main()
