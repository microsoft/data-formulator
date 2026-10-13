"""Python helpers and packages for sandboxed code (design-docs/60).

The agent may keep Python helper modules in the workspace (``files/lib/cleaning.py``
imports as ``lib.cleaning``) and, with the terminal, install packages into the
session (``scratch/.packages``). Sandboxed code imports both.

Only helpers the agent wrote are importable: its write signs the content (with a
key kept by the server), and an upload or a user's edit carries no signature. The host passes the verified sources
with each execution; an importer placed after the regular ones serves them, so a
helper can never shadow an installed module, and helpers from an earlier execution
are dropped so an edited helper is imported fresh.
"""

from __future__ import annotations

import hashlib
import hmac
import importlib.util
import logging
import os
import secrets
from typing import Any

logger = logging.getLogger(__name__)

MAX_HELPER_BYTES = 1_000_000
PACKAGES_DIR = ".packages"
_SIGNATURE_DOMAIN = "df-session-helper\n"

_BOOTSTRAP = r'''
def __df_session_imports(sources, packages_dir):
    import importlib.abc, importlib.machinery, linecache, sys
    for name in [name for name, module in list(sys.modules.items())
                 if str(getattr(getattr(module, "__spec__", None), "origin", "") or "").startswith("files/")
                 and getattr(module, "__df_session__", False)]:
        del sys.modules[name]
    sys.meta_path[:] = [finder for finder in sys.meta_path if not getattr(finder, "__df_session__", False)]
    packages = {name.rsplit(".", depth)[0] for name in sources for depth in range(1, name.count(".") + 1)}

    class SessionImporter(importlib.abc.MetaPathFinder, importlib.abc.Loader):
        __df_session__ = True

        def find_spec(self, fullname, path=None, target=None):
            if fullname not in sources and fullname not in packages:
                return None
            origin = sources[fullname][0] if fullname in sources else "files/" + fullname.replace(".", "/")
            spec = importlib.machinery.ModuleSpec(fullname, self, origin=origin, is_package=fullname in packages)
            spec.has_location = fullname in sources
            return spec

        def create_module(self, spec):
            return None

        def exec_module(self, module):
            module.__df_session__ = True
            if module.__spec__.submodule_search_locations is not None:
                module.__path__ = []
            if module.__name__ in sources:
                path, source = sources[module.__name__]
                module.__file__ = path
                linecache.cache[path] = (len(source), None, source.splitlines(True), path)
                exec(compile(source, path, "exec"), module.__dict__)

    sys.meta_path.append(SessionImporter())
    if packages_dir and packages_dir not in sys.path:
        sys.path.append(packages_dir)

'''


_KEY_FILE = ".helper-signing-key"


def _signing_key() -> bytes:
    """``DF_CODE_SIGNING_SECRET`` when set (shared by instances), else a key kept in Data Formulator's
    home, so helpers stay importable across restarts (the Flask secret may change on each start)."""
    explicit = os.environ.get("DF_CODE_SIGNING_SECRET")
    if explicit:
        return hmac.new(b"df-session-helper", explicit.encode("utf-8"), hashlib.sha256).digest()
    from data_formulator.datalake.workspace import get_data_formulator_home
    path = get_data_formulator_home() / _KEY_FILE
    try:
        return bytes.fromhex(path.read_text().strip())
    except (OSError, ValueError):
        pass
    path.parent.mkdir(parents=True, exist_ok=True)
    key = secrets.token_bytes(32)
    try:
        descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(descriptor, "w") as handle:
            handle.write(key.hex())
    except FileExistsError:
        return bytes.fromhex(path.read_text().strip())
    return key


def _sign(text: str) -> str:
    return hmac.new(_signing_key(), (_SIGNATURE_DOMAIN + text).encode("utf-8"), hashlib.sha256).hexdigest()


def sign_helper(filename: str, content: bytes) -> str | None:
    """The signature that makes a Python helper the agent wrote importable."""
    if not filename.endswith(".py"):
        return None
    try:
        return _sign(content.decode("utf-8"))
    except UnicodeDecodeError:
        return None


def helper_sources(workspace: Any) -> dict[str, tuple[str, str]]:
    """Importable helpers: module name -> (files/ path, source), signed ones only."""
    from data_formulator.analyst.session_files import helper_module_name

    sources: dict[str, tuple[str, str]] = {}
    total = 0
    try:
        files = workspace.list_workspace_files()
    except Exception:
        logger.warning("Could not list workspace files for helpers", exc_info=True)
        return sources
    for item in files:
        module = helper_module_name(f"files/{item.name}")
        if not module or not item.code_signature or item.file_size > MAX_HELPER_BYTES:
            continue
        try:
            _, content = workspace.read_workspace_file(item.name)
            text = content.decode("utf-8")
        except Exception:
            continue
        if not hmac.compare_digest(_sign(text), item.code_signature):
            continue
        total += len(content)
        if total > 4 * MAX_HELPER_BYTES:
            break
        sources[module] = (f"files/{item.name}", text)
    return sources


def packages_dir(workspace_path: str | None) -> str | None:
    """The session's installed-packages folder (in scratch), when it exists."""
    if not workspace_path:
        return None
    path = os.path.join(workspace_path, "scratch", PACKAGES_DIR)
    return path if os.path.isdir(path) else None


def with_session_imports(code: str, workspace: Any, workspace_path: str | None = None) -> str:
    """``code`` with the importer for the workspace's helpers and installed packages set up first.

    The setup is one line in its own namespace (after any ``from __future__`` imports), so
    the code's names and line numbers barely change.
    """
    sources = helper_sources(workspace) if workspace is not None else {}
    packages = packages_dir(workspace_path)
    if not sources and not packages:
        return code
    setup = _BOOTSTRAP + f"\n__df_session_imports({sources!r}, {packages!r})\n"
    line = f"exec({setup!r}, {{'__name__': '__df_session__'}})"
    lines = code.split("\n")
    at = 0
    for index, text in enumerate(lines):
        if text.startswith("from __future__"):
            at = index + 1
        elif text.strip() and not text.lstrip().startswith("#"):
            break
    return "\n".join([*lines[:at], line, *lines[at:]])


def helper_warnings(path: str) -> list[str]:
    """Problems with a helper's module name the agent should hear about when it writes one."""
    from data_formulator.analyst.session_files import helper_module_name

    if not path.endswith(".py"):
        return []
    module = helper_module_name(path if path.startswith("files/") else f"files/{path}")
    if module is None:
        return [f"{path} is not importable: folder and file names must be Python identifiers (lib/clean_data.py)."]
    top = module.split(".")[0]
    try:
        installed = importlib.util.find_spec(top) is not None
    except (ImportError, ValueError):
        installed = False
    if installed:
        return [f"{path} is not importable as {module}: {top} is an installed module, which wins. Rename the file or folder."]
    return []
