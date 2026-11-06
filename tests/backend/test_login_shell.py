"""The desktop app adopts the user's login-shell PATH and profile variables (macOS apps opened from Finder have neither)."""

from __future__ import annotations

import os
import stat
import sys
from pathlib import Path

import pytest

from data_formulator.login_shell import adopt_login_shell_environment

pytestmark = [pytest.mark.backend, pytest.mark.skipif(sys.platform == "win32", reason="POSIX shells only")]


def fake_shell(tmp_path: Path, profile: str) -> str:
    """A shell that runs its profile, then the `-ilc` command it was given."""
    shell = tmp_path / "fake-shell"
    shell.write_text(f"#!/bin/sh\n{profile}\nexec /bin/sh -c \"$2\"\n")
    shell.chmod(shell.stat().st_mode | stat.S_IXUSR)
    return str(shell)


def test_puts_the_login_path_first_and_fills_unset_profile_variables(tmp_path):
    shell = fake_shell(tmp_path, "echo 'welcome back'\n"
                                 "export PATH=/opt/homebrew/bin:/Users/me/.local/bin:/usr/bin:/bin\n"
                                 "export AWS_PROFILE=dev\nexport KUBECONFIG=/shell/kube\nexport SECRET_TOKEN=nope")
    environ = {"SHELL": shell, "PATH": "/usr/bin:/bin:/usr/sbin:/sbin", "KUBECONFIG": "/app/kube"}

    assert adopt_login_shell_environment(environ) is True

    assert environ["PATH"] == os.pathsep.join(["/opt/homebrew/bin", "/Users/me/.local/bin", "/usr/bin", "/bin",
                                               "/usr/sbin", "/sbin"])
    assert environ["AWS_PROFILE"] == "dev"
    # The app's own settings win, and variables outside the terminal's allowlist are not adopted.
    assert environ["KUBECONFIG"] == "/app/kube"
    assert "SECRET_TOKEN" not in environ


def test_leaves_the_environment_alone_when_the_shell_hangs_or_fails(tmp_path):
    environ = {"SHELL": fake_shell(tmp_path, "sleep 5"), "PATH": "/usr/bin:/bin"}
    assert adopt_login_shell_environment(environ, timeout=0.5) is False
    assert environ == {"SHELL": environ["SHELL"], "PATH": "/usr/bin:/bin"}

    environ = {"SHELL": str(tmp_path / "missing-shell"), "PATH": "/usr/bin:/bin"}
    assert adopt_login_shell_environment(environ) is False
    assert environ["PATH"] == "/usr/bin:/bin"
