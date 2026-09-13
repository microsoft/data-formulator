import importlib.util
import hashlib
import json
import plistlib
import subprocess
from pathlib import Path

import pytest


pytestmark = [pytest.mark.backend]
ROOT = Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location("macos_release", ROOT / "packaging/macos/release.py")
release = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(release)
TEAM_ID = "ABCDEFGHIJ"
DETAILS = (
    "Authority=Developer ID Application: Example (ABCDEFGHIJ)\n"
    "TeamIdentifier=ABCDEFGHIJ\n"
    "CodeDirectory v=20500 size=100 flags=0x10000(runtime) hashes=2\n"
    "Timestamp=Sep 13, 2026 at 12:00:00 PM\n"
)


@pytest.fixture
def bundle(tmp_path):
    app = tmp_path / "Data Formulator.app"
    executable = app / "Contents/MacOS/Data Formulator"
    executable.parent.mkdir(parents=True)
    executable.write_bytes(b"executable")
    info = {
        "CFBundleIdentifier": release.BUNDLE_ID, "CFBundleExecutable": "Data Formulator",
        "CFBundlePackageType": "APPL", "CFBundleShortVersionString": "0.8.0",
        "CFBundleVersion": "0.8.0b1",
    }
    with (app / "Contents/Info.plist").open("wb") as stream:
        plistlib.dump(info, stream)
    project = tmp_path / "pyproject.toml"
    project.write_text('[project]\nversion = "0.8.0b1"\n')
    return app, project


@pytest.mark.parametrize("version,short,build", [
    ("0.8.0a2", "0.8.0", "0.8.0a2"),
    ("0.8.0b1", "0.8.0", "0.8.0b1"),
    ("0.8.0rc3", "0.8.0", "0.8.0fc3"),
    ("0.8.0", "0.8.0", "0.8.0"),
    ("0.9", "0.9.0", "0.9.0"),
])
def test_bundle_versions(tmp_path, version, short, build):
    project = tmp_path / "pyproject.toml"
    project.write_text(f'[project]\nversion = "{version}"\n')
    assert release.bundle_versions(project) == {
        "version": version, "shortVersion": short, "buildVersion": build,
    }


@pytest.mark.parametrize("version", ["1.0a0", "1.0b256", "10000.0", "1.100", "1.0.100", "1.0+local"])
def test_bundle_versions_reject_unrepresentable_versions(tmp_path, version):
    project = tmp_path / "pyproject.toml"
    project.write_text(f'[project]\nversion = "{version}"\n')
    with pytest.raises(ValueError):
        release.bundle_versions(project)


def fake_tools(monkeypatch, details=DETAILS, fail=None):
    calls = []

    def run(command, log=None):
        calls.append(command)
        if fail and fail(command):
            raise RuntimeError("platform tool failed")
        if command[:2] == ["lipo", "-archs"]:
            return "arm64\n"
        if command[:2] == ["codesign", "-dvvv"]:
            return details
        return ""

    monkeypatch.setattr(release, "run", run)
    return calls


def test_prepare_sets_version_and_preserves_archive_layout(bundle, tmp_path, monkeypatch):
    app, project = bundle
    calls = fake_tools(monkeypatch)
    monkeypatch.setattr(release.subprocess, "run", lambda *a, **k: subprocess.CompletedProcess(
        a[0], 0, "", "Signature=adhoc\n",
    ))
    release.prepare(app, tmp_path / "signing/app.zip", "arm64", project)
    with (app / "Contents/Info.plist").open("rb") as stream:
        info = plistlib.load(stream)
    assert info["CFBundleVersion"] == "0.8.0b1"
    assert calls[-1] == [
        "ditto", "-c", "-k", "--sequesterRsrc", "--keepParent",
        str(app), str(tmp_path / "signing/app.zip"),
    ]


def test_prepare_refuses_to_modify_signed_bundle(bundle, tmp_path, monkeypatch):
    app, project = bundle
    original = (app / "Contents/Info.plist").read_bytes()
    fake_tools(monkeypatch)
    monkeypatch.setattr(release.subprocess, "run", lambda *a, **k: subprocess.CompletedProcess(
        a[0], 0, "", DETAILS,
    ))
    with pytest.raises(ValueError, match="already signed"):
        release.prepare(app, tmp_path / "app.zip", "arm64", project)
    assert (app / "Contents/Info.plist").read_bytes() == original


def test_prepare_rejects_existing_archive(bundle, tmp_path):
    output = tmp_path / "app.zip"
    output.write_bytes(b"existing")
    with pytest.raises(ValueError, match="overwrite"):
        release.prepare(bundle[0], output, "arm64", bundle[1])
    assert output.read_bytes() == b"existing"


def test_inspect_rejects_wrong_architecture(bundle, monkeypatch):
    fake_tools(monkeypatch)
    with pytest.raises(ValueError, match="Expected x86_64"):
        release.inspect_bundle(bundle[0], "x86_64", bundle[1])


def test_inspect_rejects_external_symlink(bundle, tmp_path, monkeypatch):
    fake_tools(monkeypatch)
    (bundle[0] / "Contents/escape").symlink_to(tmp_path)
    with pytest.raises(ValueError, match="external"):
        release.inspect_bundle(bundle[0], "arm64", bundle[1])


def test_verify_signed_candidate_is_not_release_eligible(bundle, tmp_path, monkeypatch):
    calls = fake_tools(monkeypatch)
    reports = tmp_path / "reports"
    release.verify(bundle[0], "arm64", bundle[1], reports, TEAM_ID)
    evidence = json.loads((reports / "signature.json").read_text())
    assert evidence["passed"] is True
    assert evidence["releaseEligible"] is False
    assert evidence["notarized"] is False
    assert evidence["guiVerified"] is False
    assert len(evidence["executableSha256"]) == 64
    verification = next(call for call in calls if "--verify" in call)
    assert "--deep" in verification and "--strict" in verification
    assert "certificate leaf[subject.OU]" in verification[verification.index("-R") + 1]
    assert verification[verification.index("-R") + 1].startswith("=anchor apple generic")
    assert not any("stapler" in call for call in calls)


@pytest.mark.parametrize("details", [
    DETAILS.replace("ABCDEFGHIJ", "WRONGTEAM1"),
    DETAILS.replace("Authority=Developer ID Application:", "Authority=Apple Development:"),
    DETAILS.replace("0x10000(runtime)", "0x2(adhoc)"),
    DETAILS.replace("Timestamp=", "Signed Time="),
])
def test_verify_rejects_wrong_signing_properties(bundle, tmp_path, monkeypatch, details):
    fake_tools(monkeypatch, details)
    reports = tmp_path / "reports"
    reports.mkdir()
    (reports / "signature.json").write_text('{"passed":true}')
    with pytest.raises(ValueError):
        release.verify(bundle[0], "arm64", bundle[1], reports, TEAM_ID)
    assert json.loads((reports / "signature.json").read_text())["passed"] is False


@pytest.mark.parametrize("operation", ["--verify", "staple", "validate", "--assess"])
def test_platform_failure_never_leaves_success(bundle, tmp_path, monkeypatch, operation):
    fake_tools(monkeypatch, fail=lambda command: operation in command)
    reports = tmp_path / "reports"
    with pytest.raises(RuntimeError, match="platform tool failed"):
        release.verify(bundle[0], "arm64", bundle[1], reports, TEAM_ID, staple=True)
    assert json.loads((reports / "signature.json").read_text())["passed"] is False


def test_staple_requires_both_ticket_and_gatekeeper(bundle, tmp_path, monkeypatch):
    calls = fake_tools(monkeypatch)
    reports = tmp_path / "reports"
    release.verify(bundle[0], "arm64", bundle[1], reports, TEAM_ID, staple=True)
    assert ["xcrun", "stapler", "staple", str(bundle[0])] in calls
    assert ["xcrun", "stapler", "validate", str(bundle[0])] in calls
    assert any("--assess" in call for call in calls)
    evidence = json.loads((reports / "signature.json").read_text())
    assert evidence["passed"] is True and evidence["notarized"] is True
    assert evidence["releaseEligible"] is False


def test_verify_rejects_version_drift(bundle, tmp_path, monkeypatch):
    fake_tools(monkeypatch)
    bundle[1].write_text('[project]\nversion = "0.8.0b2"\n')
    with pytest.raises(ValueError, match="version"):
        release.verify(bundle[0], "arm64", bundle[1], tmp_path / "reports", TEAM_ID)


def test_run_preserves_failure_output(tmp_path, monkeypatch):
    monkeypatch.setattr(release.subprocess, "run", lambda *a, **k: subprocess.CompletedProcess(
        a[0], 1, "stdout\n", "signature invalid\n",
    ))
    log = tmp_path / "codesign.log"
    with pytest.raises(RuntimeError, match="signature invalid"):
        release.run(["codesign", "--verify", "app"], log)
    assert "signature invalid" in log.read_text()


@pytest.mark.parametrize("staple", [False, True])
def test_dmg_requires_outer_and_copied_app_trust(bundle, tmp_path, monkeypatch, staple):
    calls = fake_tools(monkeypatch)
    image = tmp_path / "candidate.dmg"
    image.write_bytes(b"signed disk image")
    copied = []
    verified = []
    monkeypatch.setattr(release, "copy_from_dmg", lambda source, app: copied.append((source, app)))
    monkeypatch.setattr(release, "verify", lambda *args, **kwargs: verified.append((args, kwargs)))
    reports = tmp_path / "reports"
    release.verify_dmg(image, "arm64", bundle[1], reports, TEAM_ID, staple=staple)
    evidence = json.loads((reports / "dmg-signature.json").read_text())
    assert evidence["passed"] is True
    assert evidence["notarized"] is True
    assert evidence["releaseEligible"] is False
    assert evidence["sha256"] == hashlib.sha256(image.read_bytes()).hexdigest()
    assert len(copied) == len(verified) == 1
    assert verified[0][0][0] == copied[0][1]
    assert verified[0][1] == {"notarized": True}
    assert ["hdiutil", "verify", str(image)] in calls
    assert ["xcrun", "stapler", "validate", str(image)] in calls
    assert (["xcrun", "stapler", "staple", str(image)] in calls) is staple
    assert any("context:primary-signature" in call for call in calls)


@pytest.mark.parametrize("operation", ["--verify", "staple", "validate", "--assess"])
def test_dmg_platform_failure_blocks_candidate(bundle, tmp_path, monkeypatch, operation):
    fake_tools(monkeypatch, fail=lambda command: operation in command)
    image = tmp_path / "candidate.dmg"
    image.write_bytes(b"untrusted disk image")
    reports = tmp_path / "reports"
    with pytest.raises(RuntimeError, match="platform tool failed"):
        release.verify_dmg(image, "arm64", bundle[1], reports, TEAM_ID, staple=True)
    assert json.loads((reports / "dmg-signature.json").read_text())["passed"] is False


def test_dmg_rejects_copied_app_failure(bundle, tmp_path, monkeypatch):
    fake_tools(monkeypatch)
    image = tmp_path / "candidate.dmg"
    image.write_bytes(b"signed disk image")
    monkeypatch.setattr(release, "copy_from_dmg", lambda *args: None)

    def fail(*args, **kwargs):
        raise ValueError("copied app is not trusted")

    monkeypatch.setattr(release, "verify", fail)
    reports = tmp_path / "reports"
    with pytest.raises(ValueError, match="copied app"):
        release.verify_dmg(image, "arm64", bundle[1], reports, TEAM_ID)
    assert json.loads((reports / "dmg-signature.json").read_text())["passed"] is False
