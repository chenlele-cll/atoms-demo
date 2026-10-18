"""Control dispatch, public result projection and raw private configuration."""
import contextlib
import io
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import tarfile
from types import SimpleNamespace
import unittest
from uuid import uuid4

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "deploy"))
import controller
from policy import InputError


def package(stage):
    folder = stage / ("package-" + str(uuid4()))
    files = {"backend/package.json": json.dumps({"name": "@atoms/backend", "type": "module"}),
             "backend/dist/server.js": "// fixture", "backend/dist/app.js": "// fixture",
             "backend/node_modules/.pnpm/contracts/dist/index.js": "export const snapshotSchema={};",
             "frontend/index.html": "fixture", "deploy/nginx.conf.template": "fixture"}
    for name, value in files.items():
        target = folder / name
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(value)
    (folder / "backend/node_modules/@atoms").mkdir()
    (folder / "backend/node_modules/@atoms/contracts").symlink_to("../.pnpm/contracts")
    script = """
import {prepareBackendTemplate} from './scripts/prepare-company-template.mjs';
import {sealRelease} from './scripts/release/artifact.mjs';
import {copyFile, mkdir, readFile, writeFile, chmod, readdir} from 'node:fs/promises';
const folder=process.argv[1], assets=folder+'/backend/dist/template-assets';
await prepareBackendTemplate({outputDirectory:assets,sourceDirectory:'templates/company-landing'});
// Match the historical generated module's single-identity export.
const runtime=await readFile(assets+'/bundle.mjs','utf8');
const {companyTemplateIdentity}=await import('file://'+assets+'/bundle.mjs');
await writeFile(assets+'/bundle.mjs',runtime.slice(0,runtime.indexOf('export const templateIdentities'))+'export const companyTemplateIdentity = '+JSON.stringify(companyTemplateIdentity)+';\\n');
await mkdir(folder+'/frontend/template-assets');
await copyFile(assets+'/company-landing.bundle.json',folder+'/frontend/template-assets/company-landing.bundle.json');
async function modes(dir){await chmod(dir,0o755);for(const item of await readdir(dir,{withFileTypes:true})){if(item.isDirectory())await modes(dir+'/'+item.name);else if(item.isFile())await chmod(dir+'/'+item.name,0o644);}}
await modes(folder);
await sealRelease(folder,JSON.parse(process.argv[2]));
"""
    identity = {"releaseId": str(uuid4()), "sourceDigest": "2" * 64, "lockDigest": "3" * 64,
                "buildDigest": "4" * 64, "pnpm": "pnpm@12.11.2"}
    subprocess.run([controller.node_binary(ROOT), "--input-type=module", "-e", script,
                    str(folder), json.dumps(identity)], cwd=ROOT, check=True, capture_output=True, text=True, timeout=30)
    return folder


class ControllerTests(unittest.TestCase):
    def test_local_model_config_uses_node_dotenv_and_imports_only_nonempty_model_keys(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary).resolve()
            (root / "backend").mkdir()
            (root / ".nvmrc").write_bytes((ROOT / ".nvmrc").read_bytes())
            (root / ".gitignore").write_text("backend/.env\n")
            subprocess.run(["git", "init", "-q", str(root)], check=True, capture_output=True)
            self.assertEqual(controller.local_model_environment(root), {})
            env = root / "backend/.env"
            secret = 'literal\\)${NOT_EXPANDED}#private'
            env.write_text("# explicit dotenv fixture\nexport OPENAI_API_KEY='" + secret + "'\n"
                           "MODEL_ID=fixture-model # inline comment\nMODEL_TIMEOUT_MS=\n"
                           "HOST=0.0.0.0\nDATABASE_PATH=/do/not/copy\n")
            env.chmod(0o600)
            from unittest.mock import patch
            preload = root / "unexpected.cjs"
            marker = root / "unexpected-loaded"
            preload.write_text("require('node:fs').writeFileSync(" + json.dumps(str(marker)) + ", 'loaded');")
            with patch.dict(os.environ, {"NODE_OPTIONS": "--require=" + str(preload)}):
                self.assertEqual(controller.local_model_environment(root), {
                    "OPENAI_API_KEY": secret, "MODEL_ID": "fixture-model"})
            self.assertFalse(marker.exists())
            env.chmod(0o644)
            with self.assertRaises(InputError):
                controller.local_model_environment(root)
            env.chmod(0o600)
            (root / ".gitignore").write_text("")
            with self.assertRaises(InputError):
                controller.local_model_environment(root)
            (root / ".gitignore").write_text("backend/.env\n")
            actual = root / "private-env"
            env.rename(actual)
            env.symlink_to(actual)
            with self.assertRaises(InputError):
                controller.local_model_environment(root)

    def test_prepare_explicit_patch_overrides_auto_import_and_status_never_reads_local_secrets(self):
        from unittest.mock import patch
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary).resolve()
            for name in (".nvmrc", "package.json", "deploy/artifact.mjs", "scripts/release/artifact.mjs",
                         "scripts/verification/primitives.mjs", "templates/bundle.mjs", "deploy/policy.py", "deploy/storage.py",
                         "deploy/system.py", "deploy/runtime.py", "deploy/remote.py"):
                destination = root / name
                destination.parent.mkdir(parents=True, exist_ok=True)
                destination.write_bytes((ROOT / name).read_bytes())
            options = SimpleNamespace(release=None, release_id=str(uuid4()), env_file=None)
            with patch.object(controller, "local_model_environment", return_value={"MODEL_ID": "automatic"}) as local:
                work, _ = controller.prepare(root, options)
                self.assertEqual(json.loads((work / "environment.json").read_text()), {"MODEL_ID": "automatic"})
                local.assert_called_once_with(root)
            options.env_file = "explicit-private.yml"
            with patch.object(controller, "local_model_environment") as local, patch.object(controller, "environment_patch", return_value={}):
                work, _ = controller.prepare(root, options)
                self.assertEqual(json.loads((work / "environment.json").read_text()), {})
                local.assert_not_called()
            with patch.object(controller, "local_model_environment") as local, patch.object(controller, "environment_patch") as explicit:
                work, _ = controller.prepare(root, options, action="status")
                self.assertEqual(json.loads((work / "environment.json").read_text()), {})
                local.assert_not_called()
                explicit.assert_not_called()
            release = package(root)
            manifest = (release / "release.json").read_bytes()
            for action in ("metadata", "verify"):
                result = subprocess.run([controller.node_binary(root), str(work / "kit/deploy/artifact.mjs"),
                                         action, str(release)], cwd=temporary, capture_output=True, text=True, timeout=30)
                self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
                self.assertTrue(json.loads(result.stdout)["ok"])
            self.assertEqual((release / "release.json").read_bytes(), manifest)

    def test_portable_archive_does_not_synthesize_metadata_and_preserves_manifest_inputs(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source = root / "source"
            source.mkdir()
            (source / "code.js").write_text("public fixture")
            (source / "code.js").chmod(0o644)
            (source / "alias.js").symlink_to("code.js")
            try:
                os.setxattr(source / "code.js", "user.atoms-deployment-test", b"fixture")
            except (OSError, AttributeError):
                pass
            destination = root / "input.tar.gz"
            checksum = controller.archive(source, destination)
            self.assertEqual(checksum, controller.file_digest(destination))
            self.assertEqual(destination.stat().st_mode & 0o777, 0o600)
            with tarfile.open(destination) as bundle:
                entries = {item.name: item for item in bundle.getmembers()}
                self.assertEqual(set(entries), {".", "./code.js", "./alias.js"})
                self.assertEqual(entries["./code.js"].mode, 0o644)
                self.assertTrue(entries["./alias.js"].issym())
                self.assertEqual(entries["./alias.js"].linkname, "code.js")
                self.assertTrue(all(item.uid == item.gid == 0 for item in entries.values()))

    def test_dispatch_uses_real_apply_playbook_and_private_request_file(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            for name in (".nvmrc", "package.json", "deploy/artifact.mjs", "scripts/release/artifact.mjs",
                         "scripts/verification/primitives.mjs", "templates/bundle.mjs", "deploy/policy.py", "deploy/storage.py",
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
