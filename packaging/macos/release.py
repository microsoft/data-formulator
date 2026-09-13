"""Prepare ESRP input and validate returned macOS application bundles."""

import argparse
import hashlib
import json
import plistlib
import re
import subprocess
import sys
from pathlib import Path

from packaging.version import Version

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from desktop_metadata import release_metadata


PROJECT_ROOT = Path(__file__).resolve().parents[2]
BUNDLE_ID = "com.microsoft.data-formulator"
APP_NAME = "Data Formulator.app"


def bundle_versions(project: Path) -> dict[str, str]:
    version = Version(release_metadata(project)["version"])
    release = (*version.release, *([0] * (3 - len(version.release))))
    if release[0] > 9999 or any(part > 99 for part in release[1:]):
        raise ValueError(f"Version exceeds macOS bundle version limits: {version}")
    short = ".".join(str(part) for part in release)
    build = short
    if version.pre:
        label, number = version.pre
        if not 1 <= number <= 255:
            raise ValueError("macOS prerelease build number must be between 1 and 255")
        build += f"{'fc' if label == 'rc' else label}{number}"
    return {"version": str(version), "shortVersion": short, "buildVersion": build}


def run(command: list[str], log: Path | None = None) -> str:
    result = subprocess.run(command, capture_output=True, text=True, timeout=300)
    output = result.stdout + result.stderr
    if log:
        with log.open("a") as stream:
            stream.write(f"$ {' '.join(command)}\n{output}\n")
    if result.returncode:
        raise RuntimeError(f"Command failed ({result.returncode}): {' '.join(command)}\n{output}")
    return output


def inspect_bundle(app: Path, architecture: str, project: Path) -> tuple[dict, dict]:
    if app.name != APP_NAME or app.is_symlink():
        raise ValueError(f"Expected a real {APP_NAME} directory: {app}")
    contents = app / "Contents"
    with (contents / "Info.plist").open("rb") as stream:
        info = plistlib.load(stream)
    if info.get("CFBundleIdentifier") != BUNDLE_ID or info.get("CFBundlePackageType") != "APPL":
        raise ValueError("Unexpected application bundle identifier or package type")
    if info.get("CFBundleExecutable") != "Data Formulator":
        raise ValueError("Unexpected application executable")
    executable = contents / "MacOS" / "Data Formulator"
    if not executable.is_file():
        raise ValueError(f"Missing application executable: {executable}")
    actual = run(["lipo", "-archs", str(executable)]).strip().split()
    if actual != [architecture]:
        raise ValueError(f"Expected {architecture} executable, found {actual}")
    for entry in app.rglob("*"):
        if entry.is_symlink():
            if not entry.exists() or not entry.resolve().is_relative_to(app.resolve()):
                raise ValueError(f"Broken or external application symlink: {entry}")
    return info, bundle_versions(project)


def prepare(app: Path, output: Path, architecture: str, project: Path) -> None:
    if output.exists():
        raise ValueError(f"Refusing to overwrite archive: {output}")
    if output.suffix != ".zip" or output.resolve().is_relative_to(app.resolve()):
        raise ValueError("Signing archive must be a ZIP outside the application bundle")
    info, versions = inspect_bundle(app, architecture, project)
    signature = subprocess.run(
        ["codesign", "-dvv", str(app)], capture_output=True, text=True, timeout=30,
    )
    details = signature.stdout + signature.stderr
    if signature.returncode == 0:
        if "Signature=adhoc" not in details:
            raise ValueError("Refusing to modify an already signed application")
    elif "code object is not signed at all" not in details:
        raise RuntimeError(f"Cannot inspect input signature:\n{details}")
    info["CFBundleShortVersionString"] = versions["shortVersion"]
    info["CFBundleVersion"] = versions["buildVersion"]
    with (app / "Contents" / "Info.plist").open("wb") as stream:
        plistlib.dump(info, stream)
    output.parent.mkdir(parents=True, exist_ok=True)
    run(["ditto", "-c", "-k", "--sequesterRsrc", "--keepParent", str(app), str(output)])


def verify(
    app: Path, architecture: str, project: Path, reports: Path,
    team_id: str, *, notarized: bool = False, staple: bool = False,
) -> None:
    if not re.fullmatch(r"[A-Z0-9]{10}", team_id):
        raise ValueError("Expected an explicitly approved, ten-character Apple Team ID")
    reports.mkdir(parents=True, exist_ok=True)
    report = reports / "signature.json"
    evidence = {
        "passed": False, "releaseEligible": False, "guiVerified": False,
        "notarized": False, "architecture": architecture, "teamId": team_id,
        "bundleId": BUNDLE_ID,
    }
    report.write_text(json.dumps(evidence, indent=2) + "\n")
    log = reports / "codesign.log"
    log.write_text("")
    info, versions = inspect_bundle(app, architecture, project)
    if (info.get("CFBundleShortVersionString"), info.get("CFBundleVersion")) != (
        versions["shortVersion"], versions["buildVersion"],
    ):
        raise ValueError("Signed bundle version does not match the application source")
    requirement = (
        '=anchor apple generic and '
        f'certificate leaf[subject.OU] = "{team_id}" and '
        'certificate leaf[field.1.2.840.113635.100.6.1.13] exists'
    )
    run(["codesign", "--verify", "--deep", "--strict", "--verbose=4",
         "-R", requirement, str(app)], log)
    details = run(["codesign", "-dvvv", str(app)], log)
    if f"TeamIdentifier={team_id}" not in details:
        raise ValueError("Signed bundle has an unexpected Apple Team ID")
    if not re.search(r"^Authority=Developer ID Application:", details, re.MULTILINE):
        raise ValueError("Application does not have a Developer ID Application signature")
    if not re.search(r"^CodeDirectory .*flags=.*\bruntime\b", details, re.MULTILINE):
        raise ValueError("Hardened runtime is not enabled")
    if not re.search(r"^Timestamp=.+", details, re.MULTILINE):
        raise ValueError("Developer ID signature has no secure timestamp")
    run(["codesign", "-d", "--entitlements", ":-", str(app)], reports / "entitlements.log")
    if staple:
        run(["xcrun", "stapler", "staple", str(app)], log)
    if notarized or staple:
        run(["xcrun", "stapler", "validate", str(app)], log)
        run(["spctl", "--assess", "--type", "execute", "--verbose=4", str(app)], log)
        run(["codesign", "--verify", "--deep", "--strict", "--verbose=4",
             "-R", requirement, str(app)], log)
        evidence["notarized"] = True
    executable = app / "Contents" / "MacOS" / "Data Formulator"
    evidence.update(versions)
    with executable.open("rb") as stream:
        evidence["executableSha256"] = hashlib.file_digest(stream, "sha256").hexdigest()
    evidence["passed"] = True
    report.write_text(json.dumps(evidence, indent=2) + "\n")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    for name in ("prepare", "verify", "staple"):
        command = commands.add_parser(name)
        command.add_argument("--app", type=Path, required=True)
        command.add_argument("--architecture", choices=("arm64", "x86_64"), required=True)
        command.add_argument("--project", type=Path, default=PROJECT_ROOT / "pyproject.toml")
        if name == "prepare":
            command.add_argument("--output", type=Path, required=True)
        else:
            command.add_argument("--reports", type=Path, required=True)
            command.add_argument("--team-id", required=True)
            command.add_argument("--notarized", action="store_true")
    args = parser.parse_args()
    if sys.platform != "darwin":
        parser.error("This helper requires macOS platform signing tools")
    if args.command == "prepare":
        prepare(args.app, args.output, args.architecture, args.project)
    else:
        verify(args.app, args.architecture, args.project, args.reports, args.team_id,
               notarized=args.notarized, staple=args.command == "staple")


if __name__ == "__main__":
    main()
