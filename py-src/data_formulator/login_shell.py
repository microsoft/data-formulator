# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

"""The user's login-shell environment, for an app opened from Finder or the Dock.

macOS gives such apps only ``/usr/bin:/bin:/usr/sbin:/sbin`` and none of the variables the user's shell profile
sets, so the agent's terminal commands would not find Homebrew, uv, nvm or conda tools, nor CLI profiles such as
``AWS_PROFILE``. Asking the login shell once at startup, as VS Code does, gives them the environment of the user's
own terminal.
"""

from __future__ import annotations

import os
import subprocess
from collections.abc import MutableMapping

# Profile variables the terminal passes to commands (its allowlist), adopted only when the app has none of its own.
PROFILE_KEYS = (
    "LANG", "LC_ALL",
    "AWS_PROFILE", "AWS_DEFAULT_PROFILE", "AWS_REGION", "AWS_DEFAULT_REGION", "AWS_CONFIG_FILE",
    "AWS_SHARED_CREDENTIALS_FILE", "AZURE_CONFIG_DIR", "CLOUDSDK_CONFIG", "CLOUDSDK_ACTIVE_CONFIG_NAME", "KUBECONFIG",
    "HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "NO_PROXY", "http_proxy", "https_proxy", "all_proxy", "no_proxy",
    "SSL_CERT_FILE", "SSL_CERT_DIR", "REQUESTS_CA_BUNDLE", "CURL_CA_BUNDLE", "NODE_EXTRA_CA_CERTS",
)
_MARKER = "__DATA_FORMULATOR_LOGIN_ENV__"


def login_shell_environment(shell: str, timeout: float = 5.0) -> dict[str, str] | None:
    """The environment an interactive login ``shell`` sets up, or None when it fails or takes too long."""
    try:
        # Interactive and login, so both .zprofile and .zshrc (where most PATH additions live) are read. Anything the
        # profile prints comes before the marker and is ignored.
        completed = subprocess.run([shell, "-ilc", f"printf '%s' {_MARKER}; /usr/bin/env -0"],
                                   stdin=subprocess.DEVNULL, capture_output=True, timeout=timeout,
                                   env={**os.environ, "TERM": "dumb"})
    except (OSError, subprocess.SubprocessError):
        return None
    _, found, listing = completed.stdout.partition(_MARKER.encode())
    if not found:
        return None
    environment: dict[str, str] = {}
    for entry in listing.split(b"\0"):
        key, equals, value = entry.decode("utf-8", "replace").partition("=")
        if equals and key:
            environment[key] = value
    return environment


def adopt_login_shell_environment(environ: MutableMapping[str, str] = os.environ, timeout: float = 5.0) -> bool:
    """Put the login shell's PATH first (keeping the app's own entries after it) and fill in unset profile variables."""
    shell = environ.get("SHELL") or "/bin/zsh"
    shell_environment = login_shell_environment(shell, timeout)
    if not shell_environment:
        return False
    shell_path = [entry for entry in shell_environment.get("PATH", "").split(os.pathsep) if entry]
    own_path = [entry for entry in environ.get("PATH", "").split(os.pathsep) if entry and entry not in shell_path]
    if shell_path:
        environ["PATH"] = os.pathsep.join([*shell_path, *own_path])
    for key in PROFILE_KEYS:
        if key in shell_environment and key not in environ:
            environ[key] = shell_environment[key]
    return True
