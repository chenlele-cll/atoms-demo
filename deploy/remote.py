"""Bounded JSON entry for the private transported deployment kit."""
import argparse
import ipaddress
import json
import os
from pathlib import Path
import re
import signal
import sys
from uuid import UUID

from runtime import Transaction
from storage import DeploymentFault, read_json, write_json
from system import System


def cancelled(_signal, _frame):
    raise DeploymentFault("DEPLOYMENT_INTERRUPTED")


def context(path):
    value = read_json(path)
    try:
        UUID(value["run_id"])
        ipaddress.IPv4Address(value["ip"])
        if any(type(value[key]) is not int or not 1 <= value[key] <= 65535 for key in ("backend_port", "https_port")):
            raise ValueError
        if value["backend_port"] == value["https_port"]:
            raise ValueError
        for key in ("root", "stage", "bridge", "node", "nginx", "certificate", "key", "unit_path", "site_path"):
            if not Path(value[key]).is_absolute() or ".." in Path(value[key]).parts:
                raise ValueError
        if not re.fullmatch(r"v\d+\.\d+\.\d+", value["node_version"]) or not re.fullmatch(r"pnpm@\d+\.\d+\.\d+", value["pnpm_version"]):
            raise ValueError
        if value.get("environment_file"):
            file = Path(value["environment_file"])
            if not file.resolve().is_relative_to(Path(value["stage"]).resolve()) or file.is_symlink():
                raise ValueError
            value["environment"] = read_json(file)
        return value
    except (ValueError, TypeError, KeyError):
        raise DeploymentFault("INVALID_CONTEXT") from None


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("action", choices=["resolve", "apply", "status"])
    parser.add_argument("context")
    parser.add_argument("--release")
    parser.add_argument("--result")
    args = parser.parse_args()
    value = context(args.context)
    transaction = Transaction(value, System(value))
    result = transaction.resolve() if args.action == "resolve" else transaction.status() if args.action == "status" else transaction.apply(args.release)
    return result


if __name__ == "__main__":
    os.umask(0o077)
    signal.signal(signal.SIGTERM, cancelled)
    signal.signal(signal.SIGINT, cancelled)
    try:
        result = main()
    except DeploymentFault as error:
        # Codes originate in this implementation, never in captured tool output.
        result = {"ok": False, "status": "failed", "code": error.code, "deploymentVerified": False}
    except BaseException:
        result = {"ok": False, "status": "failed", "code": "DEPLOYMENT_FAILED", "deploymentVerified": False}
    if "--result" in sys.argv:
        try:
            output = Path(sys.argv[sys.argv.index("--result") + 1])
            stage = Path(read_json(sys.argv[2])["stage"])
            if output != stage / "result.json" or stage.is_symlink():
                raise ValueError
            write_json(output, result)
        except BaseException:
            result = {"ok": False, "status": "failed", "code": "REPORT_WRITE_FAILED", "deploymentVerified": False}
    print(json.dumps(result))
    sys.exit(0 if result.get("ok") else 2)
