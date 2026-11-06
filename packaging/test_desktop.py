import argparse
import json
import os
import plistlib
import signal
import socket
import subprocess
import tempfile
from pathlib import Path


def run_process(command: list[str], env: dict, timeout: int, log: Path) -> None:
    with log.open("w") as output:
        process = subprocess.Popen(
            command, env=env, stdout=output, stderr=subprocess.STDOUT,
            start_new_session=os.name != "nt",
        )
        try:
            result = process.wait(timeout=timeout)
        except subprocess.TimeoutExpired:
            if os.name == "nt":
                subprocess.run(["taskkill", "/PID", str(process.pid), "/T", "/F"], check=False)
            else:
                os.killpg(process.pid, signal.SIGKILL)
            process.wait()
            raise RuntimeError(f"Desktop test timed out; see {log}") from None
    if result != 0:
        raise RuntimeError(f"Desktop exited with {result}; see {log}")


def smoke_test(executable: Path, home: Path, reports: Path, *, headless: bool = False) -> None:
    result_path = reports / "gui-result.json"
    result_path.unlink(missing_ok=True)
    env = os.environ.copy()
    for name in ("DF_DESKTOP_SELF_TEST", "DF_DESKTOP_GUI_TEST", "DF_DESKTOP_TEST_RESULT"):
        env.pop(name, None)
    env["DATA_FORMULATOR_HOME"] = str(home)
    with socket.socket() as listener:
        listener.bind(("127.0.0.1", 0))
        env["DF_DESKTOP_COORDINATION_PORT"] = str(listener.getsockname()[1])
    run_process([str(executable)], {**env, "DF_DESKTOP_SELF_TEST": "1"}, 180, reports / "sandbox.log")
    if headless:
        result_path.write_text(json.dumps({"passed": False, "skipped": True, "message": "Headless candidate validation; GUI not verified"}) + "\n")
        return
    run_process([str(executable)], {
        **env, "DF_DESKTOP_GUI_TEST": "1", "DF_DESKTOP_TEST_RESULT": str(result_path),
    }, 150, reports / "gui.log")
    if not result_path.exists() or json.loads(result_path.read_text()).get("passed") is not True:
        raise RuntimeError(f"GUI did not report success; see {reports}")


def copy_from_dmg(image: Path, destination: Path) -> Path:
    attached = subprocess.run(
        ["hdiutil", "attach", "-readonly", "-nobrowse", "-plist", str(image)],
        check=True, capture_output=True,
    )
    entities = plistlib.loads(attached.stdout)["system-entities"]
    mounted = next(entity for entity in entities if "mount-point" in entity)
    mount = Path(mounted["mount-point"])
    try:
        if not (mount / "Applications").is_symlink() or os.readlink(mount / "Applications") != "/Applications":
            raise RuntimeError("DMG is missing the Applications shortcut")
        source = mount / "Data Formulator.app"
        subprocess.run(["ditto", str(source), str(destination)], check=True)
        for original in source.rglob("*"):
            if original.is_symlink():
                copied = destination / original.relative_to(source)
                if not copied.is_symlink() or os.readlink(copied) != os.readlink(original):
                    raise RuntimeError(f"Bundle symlink was not preserved: {original}")
    finally:
        subprocess.run(["hdiutil", "detach", mounted["dev-entry"]], check=True)
    return destination / "Contents/MacOS/Data Formulator"


def main() -> None:
    parser = argparse.ArgumentParser()
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument("--exe", type=Path)
    source.add_argument("--dmg", type=Path)
    parser.add_argument("--reports", type=Path, required=True)
    parser.add_argument("--data-home", type=Path, help="Existing isolated test data directory to retain across runs")
    parser.add_argument("--headless", action="store_true", help="Candidate-only sandbox check; does not verify the GUI")
    args = parser.parse_args()
    reports = args.reports.resolve()
    reports.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="df-desktop-test-", ignore_cleanup_errors=True) as directory:
        temporary = Path(directory)
        executable = args.exe.resolve() if args.exe else copy_from_dmg(args.dmg.resolve(), temporary / "Data Formulator.app")
        if not executable.is_file():
            raise RuntimeError(f"Missing executable: {executable}")
        home = args.data_home.resolve() if args.data_home else temporary / "data"
        if args.data_home:
            if not home.is_dir():
                raise RuntimeError(f"Test data directory does not exist: {home}")
        else:
            home.mkdir()
        if args.headless:
            smoke_test(executable, home, reports, headless=True)
        else:
            smoke_test(executable, home, reports)
    if args.headless:
        print(f"PASS: sandbox only; GUI NOT VERIFIED (candidate only); reports: {reports}")
    else:
        print(f"PASS: sandbox and native GUI; reports: {reports}")


if __name__ == "__main__":
    main()