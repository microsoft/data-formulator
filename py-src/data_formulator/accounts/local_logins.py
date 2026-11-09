# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

"""A login this computer already has, that a sign-in may reuse (design-docs/72).

A spec says how to read it (``local``): a command whose output is the secret (``gh auth token``), a file
(``~/.kaggle/access_token``), or an environment variable, optionally JSON holding the secret's parts under named
fields (``kaggle.json``'s username and key). The sign-in card shows the read as written; it runs only when the user
chooses it there, then each time the sign-in is used (so it follows the login), never in a shell. What it reads is
checked like a pasted key, and goes only to the spec's hosts.
"""

from __future__ import annotations

import json
import os
import re
import shlex
import shutil
import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import Any

# An app started from the desktop may not have a shell's PATH.
_EXTRA_PATHS = ("/opt/homebrew/bin", "/usr/local/bin", "/usr/bin")
_ENV = re.compile(r"^[A-Za-z_][A-Za-z0-9_]{0,99}$")
_FIELD = re.compile(r"^[\w.-]{1,60}$")
MAX_OUTPUT = 64 * 1024
TIMEOUT = 15


class LocalLoginError(ValueError):
    pass


@dataclass(frozen=True)
class LocalLogin:
    command: tuple[str, ...] = ()
    file: str | None = None
    env: str | None = None
    # (part of the secret, the JSON key holding it), when what is read is JSON.
    fields: tuple[tuple[str, str], ...] = ()

    def describe(self) -> str:
        """The read as the card shows it."""
        return shlex.join(self.command) if self.command else self.file if self.file else f"${self.env}"

    def public(self) -> dict[str, Any]:
        return {**({"command": list(self.command)} if self.command else {}),
                **({"file": self.file} if self.file else {}), **({"env": self.env} if self.env else {}),
                **({"fields": dict(self.fields)} if self.fields else {})}


def parse_local(raw: Any, auth_type: str) -> LocalLogin:
    """How a spec reads this computer's login, checked; raises ``LocalLoginError`` saying what is wrong."""
    if not isinstance(raw, dict):
        raise LocalLoginError("local is an object with one of command, file or env.")
    command, file, env = raw.get("command"), raw.get("file"), raw.get("env")
    if sum(bool(value) for value in (command, file, env)) != 1:
        raise LocalLoginError("local reads one of: command (a list of arguments), file, or env.")
    if command and (not isinstance(command, list) or not 1 <= len(command) <= 12
                    or not all(isinstance(arg, str) and arg and len(arg) <= 200 for arg in command)):
        raise LocalLoginError("local.command is a list of 1 to 12 arguments, run without a shell, e.g. "
                              "['gh', 'auth', 'token'].")
    if file and (not isinstance(file, str) or len(file) > 300):
        raise LocalLoginError("local.file is a path, e.g. '~/.kaggle/access_token'.")
    if env and (not isinstance(env, str) or not _ENV.match(env)):
        raise LocalLoginError("local.env names an environment variable, e.g. 'KAGGLE_API_TOKEN'.")
    parts = ("username", "key") if auth_type == "basic" else ("token",)
    fields = raw.get("fields") or {}
    if not isinstance(fields, dict) or any(part not in parts or not isinstance(key, str) or not _FIELD.match(key)
                                           for part, key in fields.items()):
        raise LocalLoginError(f"local.fields maps {' and '.join(parts)} to the JSON keys holding them.")
    if auth_type == "basic" and set(fields) != {"username", "key"}:
        raise LocalLoginError("A username and key sign-in reads them from JSON: give local.fields with both.")
    return LocalLogin(tuple(command or ()), file or None, env or None, tuple(fields.items()))


def _run(command: tuple[str, ...]) -> str | None:
    program = command[0]
    if os.sep not in program:
        program = shutil.which(program) or shutil.which(program, path=os.pathsep.join(_EXTRA_PATHS)) or ""
    if not program:
        return None
    try:
        result = subprocess.run([program, *command[1:]], capture_output=True, timeout=TIMEOUT, check=False,
                                stdin=subprocess.DEVNULL)
    except (OSError, subprocess.SubprocessError):
        return None
    return result.stdout[:MAX_OUTPUT].decode("utf-8", "replace") if result.returncode == 0 else None


def _file(path: str) -> str | None:
    try:
        with open(Path(path).expanduser(), "rb") as handle:
            return handle.read(MAX_OUTPUT).decode("utf-8", "replace")
    except OSError:
        return None


def read_local(login: LocalLogin, auth_type: str) -> dict[str, str] | None:
    """The secret this computer's login holds, as the spec reads it; None when there is none to read."""
    text = _run(login.command) if login.command else _file(login.file) if login.file else os.environ.get(login.env or "")
    text = (text or "").strip()
    if not text:
        return None
    if not login.fields:
        return {"token": text}
    try:
        data = json.loads(text)
    except ValueError:
        return None
    if not isinstance(data, dict):
        return None
    secret = {part: data.get(key) for part, key in login.fields}
    if not all(isinstance(value, str) and value.strip() for value in secret.values()):
        return None
    if auth_type != "basic":
        return {"token": secret["token"].strip()}
    return {"username": secret["username"].strip(), "key": secret["key"].strip()}
