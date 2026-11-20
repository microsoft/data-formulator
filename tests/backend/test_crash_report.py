from __future__ import annotations

import faulthandler
import logging
import subprocess
import sys
import textwrap

import pytest

from data_formulator import crash_report


pytestmark = [pytest.mark.backend]


@pytest.fixture(autouse=True)
def reset_crash_report(monkeypatch):
    was_enabled = faulthandler.is_enabled()
    monkeypatch.setattr(crash_report, "_log_dir", None)
    monkeypatch.setattr(crash_report, "_stream", None)
    monkeypatch.setattr(crash_report, "_previous_report", None)
    yield
    if crash_report._stream is not None:
        faulthandler.disable()
        crash_report._stream.close()
    if was_enabled:
        faulthandler.enable(file=sys.__stderr__, all_threads=True)


def _crash_in_child(home) -> subprocess.CompletedProcess:
    script = textwrap.dedent(f"""
        import faulthandler
        from pathlib import Path
        from data_formulator import crash_report

        crash_report.enable(Path({str(home)!r}))

        def allocate_in_native_code():
            faulthandler._sigsegv()

        allocate_in_native_code()
    """)
    return subprocess.run([sys.executable, "-c", script], capture_output=True, text=True, timeout=60)


def test_native_crash_stack_is_reported_on_next_launch(tmp_path, caplog):
    result = _crash_in_child(tmp_path)
    assert result.returncode != 0

    crash_report.enable(tmp_path)
    with caplog.at_level(logging.ERROR):
        report = crash_report.report_previous_crash(logging.getLogger("test"))

    assert report and "allocate_in_native_code" in report
    assert "crashed during the previous session" in caplog.text
    assert "allocate_in_native_code" in caplog.text
    assert (tmp_path / "logs" / "crash.previous.log").read_text(encoding="utf-8") == report
    assert crash_report.report_previous_crash(logging.getLogger("test")) is None


def test_clean_exit_ignores_survived_exception_dumps(tmp_path, caplog):
    crash_report.enable(tmp_path)
    # Stands in for a handled first-chance exception that faulthandler still logs on Windows.
    crash_report._stream.write("Windows fatal exception: code 0x8001010d\n")
    crash_report._stream.flush()
    crash_report.mark_clean_exit()
    assert not (tmp_path / "logs" / ".session-running").exists()

    crash_report.enable(tmp_path)
    with caplog.at_level(logging.WARNING):
        assert crash_report.report_previous_crash(logging.getLogger("test")) is None
    assert caplog.text == ""
    assert not (tmp_path / "logs" / "crash.previous.log").exists()


def test_unclean_exit_without_stack_is_reported_as_unexpected(tmp_path, caplog):
    logs = tmp_path / "logs"
    logs.mkdir()
    (logs / ".session-running").touch()

    crash_report.enable(tmp_path)
    with caplog.at_level(logging.WARNING):
        assert crash_report.report_previous_crash(logging.getLogger("test")) == ""
    assert "ended unexpectedly" in caplog.text


def test_unwritable_home_does_not_block_startup(tmp_path):
    blocker = tmp_path / "not-a-directory"
    blocker.write_text("")
    crash_report.enable(blocker)
    assert crash_report._stream is None
    assert crash_report.report_previous_crash(logging.getLogger("test")) is None
